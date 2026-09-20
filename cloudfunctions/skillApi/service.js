// cloudfunctions/skillApi/service.js
// 技能字典（skills 集合）数据层：getAll / add / update / remove + 删除前引用检查
// ----------------------------------------------------------------------------
// 设计原则：技能是全局字典，被 user 与 teams 以「denormalized 冗余」方式引用
// （文档库没有外键），因此删除前必须人工确认引用情况，绝不级联删除。
// ============================================================================
const cloud = require('wx-server-sdk')
// 与 teamsApi/service.js 同口径：service 自带 init，
// 避免被 require 时 SDK 尚未初始化导致 cloud.database() 抛错（云函数加载即崩）
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const SKILL_COLL = 'skills'
const USER_COLL = 'user'
const TEAM_COLL = 'teams'

const PAGE_SIZE = 100   // 云函数单次 get 上限
const MAX_SCAN = 5000   // 扫描保护上限：超出即视为「无法确认」，禁止删除（宁可不删，不可错删）

/** 对象键中是否含该 sid（键在库中多为字符串 "1"，需按数值比对） */
function hasSidKey(obj, sidNum) {
  if (!obj || typeof obj !== 'object') return false
  return Object.keys(obj).some(k => Number(k) === sidNum)
}

class SkillService {
  constructor() {
    const db = cloud.database()
    this.db = db
    this.collection = db.collection(SKILL_COLL)
    this.userColl = db.collection(USER_COLL)
    this.teamColl = db.collection(TEAM_COLL)
  }

  // ---------------------------------------------------------------- 基础读写
  /** 只取原始技能行（内部用：重名校验等不需要引用计数，避免白扫两个集合） */
  async listRaw() {
    const res = await this.collection.orderBy('sid', 'asc').get()
    return res.data || []
  }

  /**
   * 技能全表 + 引用计数（Web 管理端 GET /skills）
   * ----------------------------------------------------------------------------
   * 【为何要 usage】管理端"使用情况"列与删除确认文案需要它：让删除风险**提前可见**，
   *   也能暴露"幽灵键"（如 userSkills=0 但 userRating=6 说明评级里残留了已移除的技能）。
   *   注意：usage 只是**提前告知**，真正的防线始终是 delete 前的 checkRefs。
   * 【为何必须一次扫描聚合】扫 user 一次 + teams 一次 → 内存按 sid 归并成一张表。
   *   若按技能逐个扫集合：25 个技能 × 4 处 = 100 次查询，云函数会明显变慢甚至超时。
   * 【字段收敛】只返回契约 DTO（sid / name / desc / usage），不再下发 `_id`。
   */
  async getAll() {
    const list = await this.listRaw()
    const { map, truncated } = await this.buildUsageMap()
    if (truncated) {
      console.warn('[skillApi] usage 聚合受 MAX_SCAN 限制，计数可能不完整')
    }
    return list.map(s => {
      const b = map.get(Number(s.sid))
      return {
        sid: s.sid,
        name: s.name,
        desc: s.desc || '',
        usage: {
          users: b ? b.userIds.size : 0,
          teams: b ? b.teamIds.size : 0,
          detail: b ? b.detail : { userSkills: 0, userRating: 0, teamNeeds: 0, teamMissing: 0 },
          // true = 扫描超限、计数不完整（当前数据量下不会出现）
          truncated,
        },
      }
    })
  }

  async findBySid(sid) {
    const res = await this.collection.where({ sid: Number(sid) }).limit(1).get()
    return (res.data && res.data[0]) ? res.data[0] : null
  }

  /**
   * 名称是否重复（照搬前端 store/skills.js 的重名口径：name 精确相等；trim 后比对）
   * @param {string} name
   * @param {number|null} excludeSid update 时排除自身
   */
  async nameExists(name, excludeSid = null) {
    const list = await this.listRaw() // 只比名称，不需要 usage（避免白扫两个集合）
    const target = String(name).trim()
    return list.some(s => {
      if (String(s.name || '').trim() !== target) return false
      if (excludeSid === null || excludeSid === undefined) return true
      return Number(s.sid) !== Number(excludeSid)
    })
  }

  /** 新 sid = 当前最大 sid + 1（沿用原 skill_add 逻辑） */
  async nextSid() {
    const res = await this.collection.orderBy('sid', 'desc').limit(1).get()
    const max = (res.data && res.data.length) ? (Number(res.data[0].sid) || 0) : 0
    return max + 1
  }

  async add(name, desc) {
    const sid = await this.nextSid()
    const data = { sid, name: String(name).trim() }
    if (desc !== undefined && desc !== null && desc !== '') data.desc = String(desc)
    await this.collection.add({ data })
    return sid
  }

  /** 只允许改 name / desc；sid 是引用键，一旦开放修改将撕裂所有引用 */
  async update(sid, patch) {
    const data = {}
    if (patch.name !== undefined) data.name = String(patch.name).trim()
    if (patch.desc !== undefined) data.desc = String(patch.desc)
    if (Object.keys(data).length === 0) return false
    await this.collection.where({ sid: Number(sid) }).update({ data })
    return true
  }

  async remove(sid) {
    const res = await this.collection.where({ sid: Number(sid) }).remove()
    return (res.stats && res.stats.removed !== undefined) ? res.stats.removed : 0
  }

  // ------------------------------------------------------------ 引用检查
  /**
   * 分页全量扫描集合（只投影需要的字段，减少传输）
   * @returns {{list: Array, truncated: boolean}} truncated=true 表示受 MAX_SCAN 限制未扫完
   */
  async scan(coll, fieldList) {
    const list = []
    const field = {}
    ;(fieldList || []).forEach(f => { field[f] = true })
    let skip = 0
    let truncated = false
    while (skip < MAX_SCAN) {
      let q = coll
      if (fieldList && fieldList.length) q = q.field(field)
      const res = await q.skip(skip).limit(PAGE_SIZE).get()
      const batch = res.data || []
      list.push(...batch)
      if (batch.length < PAGE_SIZE) break
      skip += PAGE_SIZE
      if (skip >= MAX_SCAN) truncated = true
    }
    return { list, truncated }
  }

  /**
   * 一次扫描聚合「所有技能」的引用计数（供 getAll 使用）
   * ----------------------------------------------------------------------------
   * 与 checkRefs 同口径：4 处引用；同一文档命中多处只计一次「人数 / 队伍数」。
   * 身份用**扫描数组下标**而不是 `_id` —— 不依赖 projection 是否回传 `_id`。
   * @returns {{map: Map<number,{userIds:Set,teamIds:Set,detail:object}>, truncated: boolean}}
   */
  async buildUsageMap() {
    const u = await this.scan(this.userColl, ['skills', 'skill_rating'])
    const t = await this.scan(this.teamColl, ['team_needs', 'team_missing'])

    const map = new Map()
    const bucket = (sid) => {
      const key = Number(sid)
      if (Number.isNaN(key)) return null
      let b = map.get(key)
      if (!b) {
        b = {
          userIds: new Set(),
          teamIds: new Set(),
          detail: { userSkills: 0, userRating: 0, teamNeeds: 0, teamMissing: 0 },
        }
        map.set(key, b)
      }
      return b
    }

    u.list.forEach((doc, idx) => {
      if (Array.isArray(doc.skills)) {
        // 同一文档里重复写的 sid 只计一次
        new Set(doc.skills.map(Number)).forEach(sid => {
          const b = bucket(sid)
          if (!b) return
          b.detail.userSkills++
          b.userIds.add(idx)
        })
      }
      if (doc.skill_rating && typeof doc.skill_rating === 'object') {
        Object.keys(doc.skill_rating).forEach(k => {
          const b = bucket(k)
          if (!b) return
          b.detail.userRating++
          b.userIds.add(idx)
        })
      }
    })

    t.list.forEach((doc, idx) => {
      if (doc.team_needs && typeof doc.team_needs === 'object') {
        Object.keys(doc.team_needs).forEach(k => {
          const b = bucket(k)
          if (!b) return
          b.detail.teamNeeds++
          b.teamIds.add(idx)
        })
      }
      if (doc.team_missing && typeof doc.team_missing === 'object') {
        Object.keys(doc.team_missing).forEach(k => {
          const b = bucket(k)
          if (!b) return
          b.detail.teamMissing++
          b.teamIds.add(idx)
        })
      }
    })

    return { map, truncated: !!(u.truncated || t.truncated) }
  }

  /**
   * 删除前引用检查：扫描技能被引用的 4 个位置（缺一不可）
   *   1. user.skills         数组中含该 sid
   *   2. user.skill_rating   对象键含该 sid ← 最容易漏：删了技能，评级里还留着幽灵键
   *   3. teams.team_needs    对象键含该 sid
   *   4. teams.team_missing  对象键含该 sid
   * 【只统计、不清理】文档型数据库没有外键约束，级联删除不可逆，
   * 是否清理由管理员在看清引用情况后自行决定，云函数不替管理员做主。
   * @param {number} sid
   * @returns {{userCount, teamCount, detail:{userSkills,userRating,teamNeeds,teamMissing}, truncated}}
   */
  async checkRefs(sid) {
    const sidNum = Number(sid)
    const u = await this.scan(this.userColl, ['skills', 'skill_rating'])
    const t = await this.scan(this.teamColl, ['team_needs', 'team_missing'])

    let userSkills = 0
    let userRating = 0
    const userIds = new Set()
    u.list.forEach(doc => {
      const inSkills = Array.isArray(doc.skills) && doc.skills.map(Number).includes(sidNum)
      const inRating = hasSidKey(doc.skill_rating, sidNum)
      if (inSkills) userSkills++
      if (inRating) userRating++
      // 同一用户可能两处都命中，去重后才是真实「人数」
      if (inSkills || inRating) userIds.add(doc._id)
    })

    let teamNeeds = 0
    let teamMissing = 0
    const teamIds = new Set()
    t.list.forEach(doc => {
      const inNeeds = hasSidKey(doc.team_needs, sidNum)
      const inMissing = hasSidKey(doc.team_missing, sidNum)
      if (inNeeds) teamNeeds++
      if (inMissing) teamMissing++
      if (inNeeds || inMissing) teamIds.add(doc._id)
    })

    return {
      userCount: userIds.size,
      teamCount: teamIds.size,
      detail: { userSkills, userRating, teamNeeds, teamMissing },
      truncated: !!(u.truncated || t.truncated)
    }
  }
}

module.exports = new SkillService()
