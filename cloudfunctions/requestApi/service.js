// requestApi/service.js
// 入队邀请 / 入队申请 请求中心
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 与 teamsApi 保持一致：用户同时参赛上限
const MAX_ONGOING_CID = 5

class RequestService {
  constructor() {
    this.coll = db.collection('requests')
    this.userColl = db.collection('user')
    this.teamColl = db.collection('teams')
    this.poolColl = db.collection('matching_pool')
  }

  async getTeamByTid(tid) {
    const res = await this.teamColl.where({ tid: Number(tid) }).get()
    return res.data[0] || null
  }

  // 查询用户作为成员加入的所有队伍（队长也在 members 中）
  async getByUid(uid) {
    const res = await this.teamColl
      .where({ [`members.${Number(uid)}`]: _.exists(true) })
      .get()
    return res.data || []
  }

  async getUserByUid(uid) {
    const res = await this.userColl.where({ 'userInfo.uid': Number(uid) }).get()
    return res.data[0] || null
  }

  // 合并 cid 到用户 onGoing_cid（与 teamsApi.addOnGoing 一致：先去重合再合并）
  async addOnGoing(uid, cids) {
    const user = await this.getUserByUid(uid)
    if (!user || !cids || cids.length === 0) return
    const newCids = cids.map(Number)
    const oldCids = (user.onGoing_cid || []).map(Number)
    const remain = oldCids.filter(c => !newCids.includes(c))
    const merged = Array.from(new Set([...remain, ...newCids]))
    await this.userColl.where({ 'userInfo.uid': Number(uid) }).update({
      data: { onGoing_cid: merged }
    })
  }

  // 计算队伍技能缺口（与 teamsApi.calcTeamMissing 一致）
  calcTeamMissing(team) {
    const skillCount = {}
    Object.values(team.members || {}).forEach(skillId => {
      skillCount[skillId] = (skillCount[skillId] || 0) + 1
    })
    const missing = {}
    Object.entries(team.team_needs || {}).forEach(([skillId, needNum]) => {
      const have = skillCount[skillId] || 0
      const lack = needNum - have
      if (lack > 0) missing[skillId] = lack
    })
    return missing
  }

  /**
   * 【新增】从用户个人匹配池移除指定赛事，保留其他赛事（跨赛事匹配不受影响）
   * 全部移除后才删除整条记录并关闭 is_matching
   */
  async removeUserPoolCids(uid, cids) {
    if (!cids || cids.length === 0) return
    const poolRes = await this.poolColl.where({ type: 'user', targetId: Number(uid) }).get()
    const doc = poolRes.data[0]
    if (!doc) return
    const remain = (doc.match_items || []).filter(item => !cids.includes(Number(item.cid)))
    if (remain.length > 0) {
      await this.poolColl.doc(doc._id).update({ data: { match_items: remain } })
    } else {
      await this.poolColl.doc(doc._id).remove()
      await this.userColl.where({ 'userInfo.uid': Number(uid) }).update({
        data: { is_matching: false }
      })
    }
  }

  /**
   * 【新增】成员加入后同步队伍匹配池
   * 缺口已补齐或队伍满员 → 队伍退出匹配池；否则刷新池内缺口/条件快照
   */
  async syncTeamPoolAfterJoin(tid, team, newMissing) {
    const memberCount = Object.keys(team.members || {}).length
    const needRecruit = Object.keys(newMissing).length > 0 && memberCount < team.maxNum
    if (!needRecruit) {
      await this.poolColl.where({ type: 'team', targetId: Number(tid) }).remove()
      await this.teamColl.where({ tid: Number(tid) }).update({ data: { is_matching: false } })
      return
    }
    const poolRes = await this.poolColl.where({ type: 'team', targetId: Number(tid) }).get()
    if (poolRes.data && poolRes.data[0]) {
      const doc = poolRes.data[0]
      const items = (doc.match_items || []).map(item => ({
        ...item,
        team_missing: newMissing,
        condition: team.condition != null ? team.condition : item.condition
      }))
      await this.poolColl.doc(doc._id).update({ data: { match_items: items } })
    }
  }

  // 创建邀请/申请（幂等：同 pending 不重复创建）
  // subType='advisor'：指导老师邀请（type 必须为 invite，老师同意后不占 members，进入 teams.advisor）
  async create(params) {
    console.log('requestApi.create 函数执行')
    const { type, tid, uid, cid, skillId, subType } = params
    if (!['invite', 'apply'].includes(type)) throw new Error('type 仅支持 invite/apply')
    if (subType === 'advisor' && type !== 'invite') throw new Error('指导老师邀请仅支持 invite 类型')
    const tidNum = Number(tid)
    const uidNum = Number(uid)
    const cidNum = Number(cid)
    if (!tidNum || !uidNum || !cidNum) throw new Error('参数不完整')
    const team = await this.getTeamByTid(tidNum)
    if (!team) throw new Error('队伍不存在')
    if (team.members && team.members[uidNum]) {
      throw new Error(type === 'invite' ? '该用户已在队伍中' : '您已在该队伍中')
    }
    // 【新增】指导老师邀请专项校验：目标必须是 teacher 角色，且不在 advisor 中
    if (subType === 'advisor') {
      const advisors = (team.advisor || []).map(Number)
      if (team.teacher_uid) advisors.push(Number(team.teacher_uid))
      if (advisors.includes(uidNum)) throw new Error('该指导老师已在队伍中')
      if (Number(team.leader) === uidNum) throw new Error('队长不能作为指导老师')
      const targetUser = await this.getUserByUid(uidNum)
      if (!targetUser) throw new Error('用户不存在')
      if (targetUser.role !== 'teacher') throw new Error('仅老师（role=teacher）可担任指导老师')
    }
    // 幂等检查：同一用户对同一队伍同一赛事同一类型（含 subType）已有待处理请求时不重复创建
    const existQuery = { type, tid: tidNum, uid: uidNum, cid: cidNum, status: 'pending' }
    if (subType) existQuery.subType = subType
    const exist = await this.coll.where(existQuery).get()
    if (exist.data.length > 0) return { code: 0, duplicated: true }
    // 写库
    const insertData = {
      type,
      tid: tidNum,
      uid: uidNum,
      cid: cidNum,
      skillId: Number(skillId) || 0,
      status: 'pending',
      createTime: db.serverDate()
    }
    if (subType) insertData.subType = subType
    const addRes = await this.coll.add({ data: insertData })
    // 【新增】开发阶段：指导老师邀请默认同意（邀请记录仍创建并保留，消息照常发送给老师端）
    // 正式版前端去掉 autoAccept 参数后，恢复"老师手动同意"流程（走 handle）
    if (subType === 'advisor' && params.autoAccept) {
      const acceptRes = await this.acceptAdvisor({ ...insertData }, addRes._id)
      if (acceptRes.code !== 0) {
        // 自动同意失败则清理刚创建的邀请，避免残留 pending
        await this.coll.doc(addRes._id).remove().catch(() => {})
        throw new Error(acceptRes.msg)
      }
      return { code: 0, duplicated: false, autoAccepted: true }
    }
    return { code: 0, duplicated: false }
  }

  // 【提取】指导老师接受邀请统一逻辑：加入 teams.advisor + 同步 user.tid_list + 标记请求 accepted
  // 供 handle（老师手动同意）与 create（开发阶段 autoAccept 默认同意）共用
  async acceptAdvisor(req, requestId) {
    const team = await this.getTeamByTid(req.tid)
    if (!team) return { code: 2, msg: '队伍不存在' }
    const advisors = (team.advisor || []).map(Number)
    if (team.teacher_uid) advisors.push(Number(team.teacher_uid))
    if (advisors.includes(req.uid)) {
      if (requestId) await this.coll.doc(requestId).update({ data: { status: 'expired' } })
      return { code: 2, msg: '您已是该队伍指导老师' }
    }
    const targetUser = await this.getUserByUid(req.uid)
    if (!targetUser) return { code: 2, msg: '用户不存在' }
    if (targetUser.role !== 'teacher') return { code: 2, msg: '仅老师可担任指导老师' }
    await this.teamColl.where({ tid: req.tid }).update({
      data: { advisor: _.addToSet(req.uid) }
    })
    // 同步老师 user.tid_list，便于在"我的队伍"中看到该队伍
    await this.userColl.where({ 'userInfo.uid': req.uid }).update({
      data: { tid_list: _.addToSet(req.tid) }
    })
    if (requestId) await this.coll.doc(requestId).update({ data: { status: 'accepted' } })
    return { code: 0, msg: '已接受，成为指导老师' }
  }

  // 用户相关的所有待处理请求（收到的邀请 type=invite + 我发出的申请 type=apply）
  async getByUser(uid) {
    const uidNum = Number(uid)
    if (!uidNum) return []
    const res = await this.coll.where({ uid: uidNum, status: 'pending' }).get()
    const tids = [...new Set(res.data.map(r => r.tid))]
    let teamMap = {}
    if (tids.length > 0) {
      const teams = await this.teamColl.where({ tid: _.in(tids) }).get()
      teams.data.forEach(t => { teamMap[t.tid] = t })
    }
    return res.data.map(r => ({
      _id: r._id,
      type: r.type,
      subType: r.subType || '',
      tid: r.tid,
      uid: r.uid,
      cid: r.cid,
      skillId: r.skillId,
      createTime: r.createTime,
      msg: r.msg || '',
      teamName: teamMap[r.tid] ? teamMap[r.tid].name : '未知队伍'
    }))
  }

  // 队伍收到的待处理申请
  async getByTeam(tid) {
    const tidNum = Number(tid)
    if (!tidNum) return []
    const res = await this.coll.where({ type: 'apply', tid: tidNum, status: 'pending' }).get()
    const uids = [...new Set(res.data.map(r => r.uid))]
    let userMap = {}
    if (uids.length > 0) {
      const users = await this.userColl.where({ 'userInfo.uid': _.in(uids) }).get()
      users.data.forEach(u => { userMap[u.userInfo.uid] = u })
    }
    return res.data.map(r => {
      const user = userMap[r.uid]
      return {
        _id: r._id,
        tid: r.tid,
        uid: r.uid,
        cid: r.cid,
        skillId: r.skillId,
        createTime: r.createTime,
        username: user && user.userInfo ? (user.userInfo.username || `用户${r.uid}`) : `用户${r.uid}`
      }
    })
  }

  // 【新增】队长作为"队长"相关的待处理请求：
  //   invitesSent     - 我作为队长向队员发出的邀请（等待对方响应）
  //   appliesReceived - 我的队伍收到的入队申请（需要我同意/拒绝）
  //   tidList         - 我作为队长的队伍 tid 列表
  async getByCaptain(uid) {
    const uidNum = Number(uid)
    if (!uidNum) return { invitesSent: [], appliesReceived: [], tidList: [] }
    // 1. 查我作为队长的队伍
    const teamRes = await this.teamColl.where({ leader: uidNum }).get()
    const teams = teamRes.data || []
    const tidList = teams.map(t => Number(t.tid))
    if (tidList.length === 0) return { invitesSent: [], appliesReceived: [], tidList: [] }
    // 2. 查这些队伍的 pending 请求
    const reqRes = await this.coll.where({ tid: _.in(tidList), status: 'pending' }).get()
    const data = reqRes.data || []
    if (data.length === 0) return { invitesSent: [], appliesReceived: [], tidList }
    // 3. 关联队伍名 + 对方用户名（邀请的 uid 是被邀请人，apply 的 uid 是申请人）
    const teamMap = {}
    teams.forEach(t => { teamMap[Number(t.tid)] = t })
    const otherUids = [...new Set(data.map(r => Number(r.uid)).filter(u => u && u !== uidNum))]
    let userMap = {}
    if (otherUids.length > 0) {
      const userRes = await this.userColl.where({ 'userInfo.uid': _.in(otherUids) }).get()
      userRes.data.forEach(u => { userMap[Number(u.userInfo.uid)] = u })
    }
    const decorate = (r) => ({
      _id: r._id,
      type: r.type,
      subType: r.subType || '',
      tid: Number(r.tid),
      uid: Number(r.uid),
      cid: r.cid,
      skillId: r.skillId,
      createTime: r.createTime,
      msg: r.msg || '',
      teamName: teamMap[Number(r.tid)] ? teamMap[Number(r.tid)].name : '未知队伍',
      username: userMap[Number(r.uid)]
        ? ((userMap[Number(r.uid)].userInfo && userMap[Number(r.uid)].userInfo.username) || `用户${r.uid}`)
        : `用户${r.uid}`
    })
    const invites = data.filter(r => r.type === 'invite').map(decorate)
    const applies = data.filter(r => r.type === 'apply').map(decorate)
    return { invitesSent: invites, appliesReceived: applies, tidList }
  }

  // 处理请求：accept / reject（接受 = 加入队伍）
  async handle(params) {
    const { requestId, action } = params
    if (!requestId) throw new Error('缺少请求ID')
    let doc
    try {
      doc = await this.coll.doc(requestId).get()
    } catch (e) {
      return { code: -1, msg: '请求不存在' }
    }
    const req = doc.data
    if (!req) return { code: -1, msg: '请求不存在' }
    if (req.status !== 'pending') return { code: -1, msg: '该请求已被处理' }
    if (action === 'reject') {
      await this.coll.doc(requestId).update({ data: { status: 'rejected' } })
      return { code: 0, msg: '已拒绝' }
    }
    if (action !== 'accept') throw new Error('action 仅支持 accept/reject')
    // 【新增】notify（重新匹配提醒）：不涉及入队，accept/reject 仅标记状态，不执行加入队伍逻辑
    if (req.type === 'notify') {
      await this.coll.doc(requestId).update({ data: { status: 'accepted' } })
      return { code: 0, msg: '已处理' }
    }

    // 【新增】指导老师邀请：接受后进入 teams.advisor，不占 members，不参与参赛/匹配计数
    if (req.subType === 'advisor') {
      return await this.acceptAdvisor(req, requestId)
    }

    // 加入队伍（校验与 teamsApi.addMember 保持一致）
    const team = await this.getTeamByTid(req.tid)
    if (!team) return { code: 2, msg: '队伍不存在' }
    if (Object.keys(team.members || {}).length >= team.maxNum) return { code: 2, msg: '队伍人数已满' }
    if (team.members && team.members[req.uid]) return { code: 2, msg: '该用户已在队内' }
    const teamCids = team.cid_list || []
    const memberUser = await this.getUserByUid(req.uid)
    // 【修改】重复参赛判定基于“用户当前所属队伍覆盖的赛事”（个人报名 onGoing_cid 不拦截）
    const myTeams = await this.getByUid(req.uid)
    const myTeamCids = [...new Set((myTeams || []).flatMap(t => t.cid_list || []).map(Number))]
    const dupCids = teamCids.filter(c => myTeamCids.includes(Number(c)))
    if (dupCids.length > 0) return { code: 2, msg: '该用户已找到队伍' }
    const memberOngoing = memberUser ? (memberUser.onGoing_cid || []) : []
    const mergedCnt = Array.from(new Set([...memberOngoing, ...teamCids])).length
    if (mergedCnt > MAX_ONGOING_CID) return { code: 2, msg: `同时参赛最多${MAX_ONGOING_CID}场，已达上限` }

    const skillId = Number(req.skillId) || Object.values(team.members)[0] || 1
    const newMembers = { ...team.members, [req.uid]: skillId }
    const newMissing = this.calcTeamMissing({ ...team, members: newMembers })
    // 【修复】同 teamsApi：空对象 {} 需用 _.set() 强制覆盖，否则 team_missing 旧值不会被清空
    await this.teamColl.where({ tid: req.tid }).update({
      data: { members: newMembers, team_missing: _.set(newMissing) }
    })
    await this.addOnGoing(req.uid, teamCids)
    // 同步用户 tid_list（与 userApi.addTid 一致）
    await this.userColl.where({ 'userInfo.uid': req.uid }).update({
      data: { tid_list: _.addToSet(req.tid) }
    })
    // 【新增】仅移除被队伍覆盖赛事的个人匹配池记录（其他赛事跨赛事继续匹配，不污染 onGoing_cid）
    await this.removeUserPoolCids(req.uid, teamCids)
    // 【新增】同步队伍匹配池：缺口空/满员则队伍退池，否则刷新池内缺口快照
    await this.syncTeamPoolAfterJoin(req.tid, { ...team, members: newMembers }, newMissing)
    await this.coll.doc(requestId).update({ data: { status: 'accepted' } })
    // 【调整】仅失效同赛事（队伍覆盖赛事）的待处理申请/邀请，保留其他赛事的申请
    if (teamCids.length > 0) {
      await this.coll
        .where({
          type: _.in(['apply', 'invite']),
          uid: Number(req.uid),
          status: 'pending',
          cid: _.in(teamCids),
          _id: _.neq(requestId)
        })
        .update({ data: { status: 'expired' } })
    }
    return { code: 0, msg: '已加入队伍' }
  }
}

module.exports = new RequestService()
