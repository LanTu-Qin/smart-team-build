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
  async getAll() {
    const res = await this.collection.orderBy('sid', 'asc').get()
    return res.data || []
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
    const list = await this.getAll()
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
