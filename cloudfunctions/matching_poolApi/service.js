const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

class MatchService {
  constructor() {
    this.poolColl = db.collection('matching_pool')
    this.userColl = db.collection('user')
    this.teamColl = db.collection('teams')
    this.reqColl = db.collection('requests')
    this.compColl = db.collection('competition')
  }

  /**
   * 【新增】校验赛事是否已结束（报名中/未开始可入池，已结束拦截）
   * @param {number|string} cid
   * @returns {string|null} 错误信息；null 表示可操作
   */
  async checkCompActive(cid) {
    const res = await this.compColl.where({ cid: Number(cid) }).get()
    const comp = res.data[0]
    if (!comp) return '赛事不存在'
    if (comp.status === '已结束') return '赛事已结束，无法开启匹配'
    return null
  }

  /**
   * enterPool 开启/更新单场赛事匹配配置
   * @param {Object} params
   * type: user / team
   * targetId: uid / tid
   * cid: 目标赛事ID（数字）
   * match_skill?: 用户匹配技能数组，仅type=user使用
   */
  async enterPool(params) {
    const { type, targetId, cid, match_skill = [] } = params
    const now = new Date()
    console.log("准备写入matching_pool targetId", targetId)
    // 基础参数校验
    if (!['user', 'team'].includes(type)) throw new Error('type仅支持 user / team')
    if (typeof targetId !== 'number' || typeof cid !== 'number') throw new Error('targetId、cid必须为数字')

    // 【新增】赛事状态校验：报名中/未开始可入池，已结束拦截
    const compErr = await this.checkCompActive(cid)
    if (compErr) throw new Error(compErr)
  
    // 查询当前用户/队伍已有匹配池文档
    const docRes = await this.poolColl.where({ type, targetId }).get()
    const originDoc = docRes.data[0] || { type, targetId, match_items: [] }
    let itemList = [...originDoc.match_items]
  
    // 移除当前cid旧配置，实现覆盖更新
    itemList = itemList.filter(item => item.cid !== cid)
  
    if (type === 'user') {
      // 用户单赛事配置
      const skillArr = Array.isArray(match_skill) ? match_skill.map(Number) : []
      itemList.push({
        cid,
        match_skill: skillArr,
        skill_rating: {},
        team_missing: null,
        condition: null
      })
      // 更新用户全局匹配状态
      await this.userColl
        .where({ 'userInfo.uid': targetId })
        .update({ data: { is_matching: true } })
    } else {
      // 队伍单赛事配置
      const teamRes = await this.teamColl.where({ tid: targetId }).get()
      const team = teamRes.data[0]
      if (!team) throw new Error('队伍不存在')
      // 【拦截】仅主动邀请（condition===2）的队伍无法进入匹配池
      if (Number(team.condition) === 2) {
        throw new Error('仅主动邀请的队伍无法开启匹配')
      }
      // 【新增】拦截：队伍无技能缺口时无法进入匹配池（缺口驱动匹配）
      if (!team.team_missing || Object.keys(team.team_missing).length === 0) {
        throw new Error('队伍暂无技能缺口，无法开启匹配')
      }
      itemList.push({
        cid,
        match_skill: [],
        skill_rating: {},
        team_missing: team.team_missing || {},
        condition: team.condition ?? 0
      })
      // 更新队伍全局匹配状态
      await this.teamColl
        .where({ tid: targetId })
        .update({ data: { is_matching: true } })
    }
  
    // 构造待写入数据
    const saveData = {
      type,
      targetId,
      match_items: itemList,
      createTime: now
    }
  
    let res
    if (docRes.data.length > 0) {
      // 已有记录：局部更新
      res = await this.poolColl
        .where({ type, targetId })
        .update({ data: saveData })
      console.log("更新已有匹配记录", res)
    } else {
      // 无记录：新增完整文档
      res = await this.poolColl.add({ data: saveData })
      console.log("新增匹配记录", res)
    }

    // 【新增】队伍重新进入匹配池后，清理该队伍待处理的"重新匹配提醒"，避免通知残留
    if (type === 'team') {
      try {
        await this.reqColl
          .where({ type: 'notify', tid: targetId, status: 'pending' })
          .update({ data: { status: 'expired' } })
      } catch (e) {
        console.warn('清理重新匹配提醒失败（不影响入池）：', e.message)
      }
    }

    return true
  }
  
  /**
   * exitPool 退出匹配
   * @param {Object} params {type, targetId, cid?}
   * 传入cid：仅关闭该赛事匹配；不传cid：清空全部赛事匹配
   */
  async exitPool(params) {
    const { type, targetId, cid } = params
    // 参数校验
    if (!['user', 'team'].includes(type)) throw new Error('type仅支持 user / team')
    if (typeof targetId !== 'number') throw new Error('targetId必须为数字')
    if (cid !== undefined && typeof cid !== 'number') throw new Error('cid必须为数字')

    // 【新增】用户取消匹配后，其发出的待处理入队申请一并失效
    // 否则申请仍 pending，队伍队长可继续同意，用户会在已退出匹配的情况下被拉入队
    if (type === 'user') {
      const cond = { type: 'apply', uid: Number(targetId), status: 'pending' }
      if (cid !== undefined) cond.cid = Number(cid)   // 指定赛事：仅失效该赛事；未指定：全部失效
      const expireRes = await this.reqColl.where(cond).update({ data: { status: 'expired' } })
      console.log('[exitPool] 失效用户待处理申请', JSON.stringify(cond), 'updated=', expireRes.stats && expireRes.stats.updated)
    }

    const docRes = await this.poolColl.where({ type, targetId }).get()
    if (!docRes.data[0]) {
      // 【修复】池中无记录时也需关闭源数据匹配状态（编辑保存可能只改了 is_matching 而未入池，否则会无法关闭）
      if (type === 'user') {
        await this.userColl
          .where({ 'userInfo.uid': targetId })
          .update({ data: { is_matching: false } })
      } else {
        await this.teamColl
          .where({ tid: targetId })
          .update({ data: { is_matching: false } })
      }
      return true
    }
    let itemList = docRes.data[0].match_items
  
    if (cid !== undefined) {
      // 仅移除单个赛事
      itemList = itemList.filter(item => item.cid !== cid)
      if (itemList.length > 0) {
        // 还有其他赛事，仅更新数组
        await this.poolColl
          .where({ type, targetId })
          .update({
            data: {
              match_items: itemList,
              createTime: new Date()
            }
          })
        return true
      }
    }
    // 走到这里：itemList为空，无任何匹配赛事
    // 1. 删除匹配池整条记录
    await this.poolColl.where({ type, targetId }).remove()
    // 2. 关闭源数据匹配状态
    if (type === 'user') {
      await this.userColl
        .where({ 'userInfo.uid': targetId })
        .update({ data: { is_matching: false } })
    } else {
      await this.teamColl
        .where({ tid: targetId })
        .update({ data: { is_matching: false } })
    }
    return true
  }
  

  /**
   * getMatchList 根据当前赛事cid拉取匹配推荐列表
   * @param {Object} params {cid, selfType, selfId}
   */
  async getMatchList(params) {
    const { cid, selfType, selfId } = params

    if (!['user','team'].includes(selfType)) throw new Error('selfType只能是user/team')
    if (typeof cid !== 'number' || typeof selfId !== 'number') throw new Error('cid、selfId必须数字')

    // 一次性构建查询条件（避免链式调用潜在问题）
    const query = this.poolColl.where({
      'match_items.cid': cid,          // 点表示法匹配任何数组元素的 cid
      type: selfType === 'user' ? 'team' : 'user',
      targetId: _.neq(selfId)
    })

    const res = await query.get()
    console.log(`匹配到 ${res.data.length} 条记录`)

    // 先查询“自己”的匹配池配置（用于技能/赛事交集过滤）
    const selfRes = await this.poolColl.where({ type: selfType, targetId: selfId }).get()
    const selfDoc = selfRes.data[0]
    const selfItem = ((selfDoc && selfDoc.match_items) || []).find(m => Number(m.cid) === Number(cid))
    // 自己的技能集合：
    // - user：入池技能 match_skill（本人可提供的技能）
    // - team：队伍缺口 team_missing 的 key（队伍需要的技能）
    const selfSkills = new Set(
      selfType === 'user'
        ? (selfItem && selfItem.match_skill || []).map(Number)
        : Object.keys((selfItem && selfItem.team_missing) || {}).map(Number)
    )
    // 【新增】自己的赛事集合：match_items 中所有 cid（用于跨赛事交集过滤）
    const selfCids = new Set(((selfDoc && selfDoc.match_items) || []).map(m => Number(m.cid)))
    // 自己无技能/无缺口 → 无任何可匹配对象
    if (selfSkills.size === 0) return []

    // 技能 + 赛事双重交集过滤：
    // 1) 技能交集：对端技能与“自己”技能至少有一个相同，避免空匹配项
    // 2) 赛事交集：对端 match_items 的 cid 与“自己” match_items 的 cid 必须有交集，
    //    即双方确实都想参与同一个比赛（当前 cid 必须在交集内，防御数据异常/类型不一致导致的误匹配）
    const formatList = res.data
      .map(doc => {
        const curItem = doc.match_items.find(m => Number(m.cid) === Number(cid))
        return {
          ...doc,
          cur_cid: cid,
          cur_cids: (doc.match_items || []).map(m => Number(m.cid)),  // 对端匹配的所有赛事
          cur_match_skill: curItem?.match_skill || [],
          cur_team_missing: curItem?.team_missing ?? null,
          cur_condition: curItem?.condition ?? null
        }
      })
      .filter(item => {
        // 对端必须存在当前 cid 的匹配配置（防御：数据异常/类型不一致时直接过滤）
        const curItem = item.match_items.find(m => Number(m.cid) === Number(cid))
        if (!curItem) return false
        // 赛事交集：对端匹配的赛事集合 ∩ 自己匹配的赛事集合 必须非空
        const peerCids = item.cur_cids || []
        let hasCidInter = false
        for (const c of peerCids) {
          if (selfCids.has(Number(c))) { hasCidInter = true; break }
        }
        if (!hasCidInter) return false
        // 技能交集：
        // - 自己为 user：对端是队伍，取其需求技能 team_missing 的 key
        // - 自己为 team：对端是用户，取其入池技能 match_skill
        const peerSkills = new Set(
          selfType === 'user'
            ? Object.keys(item.cur_team_missing || {}).map(Number)
            : (item.cur_match_skill || []).map(Number)
        )
        for (const s of peerSkills) {
          if (selfSkills.has(s)) return true
        }
        return false
      })
    console.log(`技能+赛事交集过滤后 ${formatList.length} 条记录`)
    return formatList
  }

  // 【新增】查询指定用户的个人匹配池记录（用户类型）
  async getMyPool(uid) {
    if (!uid) return []
    const res = await this.poolColl.where({ type: 'user', targetId: Number(uid) }).get()
    return res.data || []
  }
}

module.exports = new MatchService()
