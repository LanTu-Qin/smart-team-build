// teamsService/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const $ = db.command.aggregate
// 【新增】同时参赛数量上限（用户 onGoing_cid 最大长度）
const MAX_ONGOING_CID = 5

class TeamsService {
  constructor() {
    this.collection = db.collection('teams')
    this.userColl = db.collection('user')
    this.poolColl = db.collection('matching_pool')
    this.reqColl = db.collection('requests')
    this.compColl = db.collection('competition')
  }

  /**
   * 【新增】校验赛事是否已结束（报名中/未开始可发布队伍，已结束拦截）
   * @param {number|string} cid
   * @returns {string|null} 错误信息；null 表示可操作
   */
  async checkCompActive(cid) {
    const res = await this.compColl.where({ cid: Number(cid) }).get()
    const comp = res.data[0]
    if (!comp) return '赛事不存在'
    if (comp.status === '已结束') return '赛事已结束，无法发布队伍'
    return null
  }

  /**
   * 获取所有团队
   */
  async getList() {
    const res = await this.collection.get()
    return res.data
  }

  /**
   * 根据tid获取单个团队
   * @param {number} tid
   */
  async getByTid(tid) {
    const res = await this.collection.where({ tid }).get()
    return res.data[0] || null
  }

  /**
   * 根据赛事cid筛选队伍
   * @param {number} cid
   */
  async getByCid(cid) {
    const res = await this.collection.where({
      cid_list: _.elemMatch(_.eq(cid))
    }).get()
    return res.data
  }

  /**
   * 给队伍新增赛事cid
   */
  async addTeamCid(tid, cid) {
    const team = await this.getByTid(tid)
    if (!team) return false
    if (team.cid_list.includes(cid)) return true
    await this.collection.where({ tid }).update({
      data: {
        cid_list: _.push(cid)
      }
    })
    // 【新增】所有成员（含队长）onGoing_cid 添加该赛事
    for (const uid of Object.keys(team.members).map(Number)) {
      await this.addOnGoing(uid, [cid])
    }
    return true
  }

  /**
   * 移除队伍某个赛事cid
   */
  async removeTeamCid(tid, cid) {
    const team = await this.getByTid(tid)
    await this.collection.where({ tid }).update({
      data: {
        cid_list: _.pull(cid)
      }
    })
    // 【新增】成员 onGoing_cid 清理（不再被其他队伍覆盖才移除）
    if (team && team.members) {
      for (const uid of Object.keys(team.members).map(Number)) {
        await this.removeOnGoingIfNoOther(uid, tid, cid)
      }
    }
    return true
  }

  /**
   * 批量替换队伍cid列表
   */
  async setTeamCidList(tid, cidList) {
    const team = await this.getByTid(tid)
    if (!team) return false
    const oldList = team.cid_list || []
    const newList = cidList || []
    const added = newList.filter(c => !oldList.includes(c))
    const removed = oldList.filter(c => !newList.includes(c))
    await this.collection.where({ tid }).update({
      data: { cid_list: newList }
    })
    // 【新增】成员 onGoing_cid 同步新增/清理
    const uids = Object.keys(team.members).map(Number)
    for (const uid of uids) {
      for (const cid of added) await this.addOnGoing(uid, [cid])
      for (const cid of removed) await this.removeOnGoingIfNoOther(uid, tid, cid)
    }
    return true
  }

  /**
   * 根据用户uid查询加入的所有队伍
   */
  async getByUid(uid) {
    const res = await this.collection.where({
      [`members.${uid}`]: _.exists(true)
    }).get()
    return res.data
  }

  // ========== 【新增】onGoing_cid 参赛赛事维护 ==========
  // user 文档顶层字段 onGoing_cid: number[]，表示该用户已作为队长/队员参加的比赛

  /**
   * 根据 uid 查用户文档
   */
  async getUserByUid(uid) {
    const res = await this.userColl.where({ 'userInfo.uid': Number(uid) }).get()
    return res.data[0] || null
  }

  /**
   * 合并 cid 列表到用户 onGoing_cid（先去重合再合并，保证稳定）
   * 用户与队伍在赛事上必有交集，先移除旧记录中与队伍赛事重合的 cid，再并入队伍赛事
   */
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

  /**
   * 从用户 onGoing_cid 移除 cid
   * 若该赛事仍被该用户的其他队伍覆盖，则保留
   */
  async removeOnGoingIfNoOther(uid, excludeTid, cid) {
    const user = await this.getUserByUid(uid)
    if (!user) return
    const otherTids = (user.tid_list || []).filter(t => Number(t) !== Number(excludeTid))
    let stillIn = false
    if (otherTids.length > 0) {
      const teamsRes = await this.collection.where({ tid: _.in(otherTids) }).get()
      stillIn = teamsRes.data.some(t => (t.cid_list || []).includes(cid))
    }
    if (!stillIn) {
      await this.userColl.where({ 'userInfo.uid': Number(uid) }).update({
        data: { onGoing_cid: _.pull(cid) }
      })
    }
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
   * 计算队伍技能缺口 team_missing
   * @param {Object} team 完整队伍对象
   * @returns {Object} missing
   */
  calcTeamMissing(team) {
    const skillCount = {}
    Object.values(team.members).forEach(skillId => {
      skillCount[skillId] = (skillCount[skillId] || 0) + 1
    })
    const missing = {}
    // 【修复】老队伍可能没有 team_needs 字段，缺失时用旧 team_missing 兜底作为需求基准，
    // 既避免 Object.entries(undefined) 抛错中断写库，又能保持缺口计算、不让队伍因缺口被误判为空而退出匹配池
    const needs = team.team_needs || team.team_missing || {}
    Object.entries(needs).forEach(([skillId, needNum]) => {
      const have = skillCount[skillId] || 0
      const lack = needNum - have
      if (lack > 0) missing[skillId] = lack
    })
    return missing
  }

  /**
   * 更新队伍匹配状态 is_matching
   */
  async setMatchStatus(tid, status) {
    const team = await this.getByTid(tid)
    if (!team) return false
    await this.collection.where({ tid }).update({
      data: { is_matching: !!status }
    })
    return true
  }

  /**
   * 修改队伍招募需求，带业务校验
   */
  async setTeamNeeds(tid, newNeeds) {
    const team = await this.getByTid(tid)
    if (!team) return { code: 1, msg: "目标队伍不存在" }
    if (typeof newNeeds !== "object" || Array.isArray(newNeeds)) {
      return { code: 1, msg: "需求格式错误，必须为{技能id:人数}对象" }
    }
    const skillCount = {}
    Object.values(team.members).forEach(sid => {
      skillCount[sid] = (skillCount[sid] || 0) + 1
    })
    const oldNeeds = team.team_needs
    // 校验1：旧需求有、新需求删掉的技能，队内有人则拦截
    for (const oldSkillId of Object.keys(oldNeeds).map(Number)) {
      if (!(oldSkillId in newNeeds)) {
        if (skillCount[oldSkillId] > 0) {
          return {
            code: 2,
            msg: `技能${oldSkillId}当前还有队员，无法删除该招募需求，请先清退对应成员`
          }
        }
      }
    }
    // 校验2：保留技能需求不能小于现有成员
    for (const skillIdStr of Object.keys(newNeeds)) {
      const skillId = Number(skillIdStr)
      const newNeed = newNeeds[skillIdStr]
      const currentHave = skillCount[skillId] || 0
      if (skillId in oldNeeds && newNeed < currentHave) {
        return {
          code: 2,
          msg: `技能${skillId}现有${currentHave}人，需求人数不能小于${currentHave}`
        }
      }
    }
    // 更新需求并重新计算缺口
    const newMissing = this.calcTeamMissing({ ...team, team_needs: newNeeds })
    await this.collection.where({ tid }).update({
      data: {
        team_needs: newNeeds,
        team_missing: newMissing
      }
    })
    return { code: 0, msg: "队伍招募需求修改成功" }
  }

  /**
   * 创建新队伍
   * @param {Object} teamInfo
   * @returns {number} tid
   */
  async create(teamInfo) {
    const tid = Date.now();
    // 合并前端传入数据 + 默认值，不再硬编码覆盖 members 和 cid_list
    const newTeam = {
      tid,
      cid_list: teamInfo.cid_list || [],
      leader: teamInfo.leader,
      members: teamInfo.members || {},
      advisor: teamInfo.advisor || [],   // 【新增】指导老师 uid 数组（不占 members，不参与匹配/参赛）
      condition: teamInfo.condition,
      name: teamInfo.name,
      maxNum: teamInfo.maxNum,
      team_needs: teamInfo.team_needs || {},
      team_missing: {},
      intro: teamInfo.intro || "",
      is_matching: !!teamInfo.is_matching
    };
    // 【新增】个人参赛模式（方案A：单人队伍）：强制单人、无招募需求、不进匹配池
    // 复用队伍全部基础设施：onGoing_cid 参赛记录、重复参赛拦截、我的队伍展示、退赛
    if (teamInfo.isPersonal) {
      newTeam.isPersonal = true
      newTeam.maxNum = 1
      newTeam.condition = 2          // 仅邀请，防止他人误入/申请个人队伍
      newTeam.team_needs = {}        // 个人参赛无招募需求
      newTeam.team_missing = {}      // 无技能缺口，天然不进匹配池
      newTeam.is_matching = false
    }

    // 【新增】赛事状态校验：报名中/未开始可发布队伍，已结束拦截
    for (const c of (teamInfo.cid_list || [])) {
      const compErr = await this.checkCompActive(c)
      if (compErr) return { code: -1, msg: compErr }
    }
    // 【新增】校验：队长参赛上限 + 已有队伍参加同赛事
    const leader = Number(teamInfo.leader)
    const cidList = teamInfo.cid_list || []
    const leaderUser = await this.getUserByUid(leader)
    const leaderOngoing = leaderUser ? (leaderUser.onGoing_cid || []) : []
    // 【修改】重复创建判定基于“队长当前所属队伍覆盖的赛事”（个人报名 onGoing_cid 不拦截）
    const leaderTeams = await this.getByUid(leader)
    const leaderTeamCids = [...new Set((leaderTeams || []).flatMap(t => t.cid_list || []).map(Number))]
    const dupCids = cidList.filter(c => leaderTeamCids.includes(Number(c)))
    if (dupCids.length > 0) {
      return { code: -1, msg: '您已有队伍在参加相关赛事，请勿重复创建' }
    }
    const mergedCnt = Array.from(new Set([...leaderOngoing, ...cidList])).length
    if (mergedCnt > MAX_ONGOING_CID) {
      return { code: -1, msg: `同时参赛最多${MAX_ONGOING_CID}场，已达上限` }
    }
  
    // 基于真实成员（含队长）计算技能缺口
    newTeam.team_missing = this.calcTeamMissing(newTeam);
    
    await this.collection.add({ data: newTeam });
    // 【新增】队长 onGoing_cid 合并 cid_list
    await this.addOnGoing(leader, cidList)
    return { code: 0, data: { tid } };
  }

  /**
   * 【新增】成员变动后同步队伍匹配池
   * 缺口已补齐或队伍满员 → 退出匹配池并关闭招募状态
   * 仍有缺口且在池中 → 刷新池内缺口/条件快照，避免推荐展示过时信息
   * @param {number} tid
   * @param {object} newTeam 更新后的队伍（含 members/condition/maxNum）
   * @param {object} newMissing 新缺口
   * @param {boolean} quitIfNoNeed 缺口空/满员时是否退出匹配池（加入 true，移除 false）
   */
  async syncTeamPool(tid, newTeam, newMissing, quitIfNoNeed) {
    const memberCount = Object.keys(newTeam.members || {}).length
    const needRecruit = Object.keys(newMissing).length > 0 && memberCount < newTeam.maxNum
    if (!needRecruit && quitIfNoNeed) {
      // 缺口已补齐或队伍满员：退出匹配池
      await this.poolColl.where({ type: 'team', targetId: tid }).remove()
      await this.collection.where({ tid }).update({ data: { is_matching: false } })
      return
    }
    if (needRecruit) {
      // 仍在匹配池中：刷新缺口/条件快照
      const poolRes = await this.poolColl.where({ type: 'team', targetId: tid }).get()
      if (poolRes.data && poolRes.data[0]) {
        const doc = poolRes.data[0]
        const items = (doc.match_items || []).map(item => ({
          ...item,
          team_missing: newMissing,
          condition: newTeam.condition != null ? newTeam.condition : item.condition
        }))
        await this.poolColl.doc(doc._id).update({ data: { match_items: items } })
      }
    }
  }

  /**
   * 添加队员
   * @param {number} tid
   * @param {number} uid
   * @param {number} skillId
   */
  async addMember(tid, uid, skillId) {
    console.log('【teamsApi.addMember v2】入参', { tid, uid, skillId, MAX_ONGOING_CID })
    // 只读调用（保留）
    const team = await this.getByTid(tid)
    const memberUser = await this.getUserByUid(uid)
    const myTeams = await this.getByUid(uid)
    console.log('addMember v2 只读查询完成', {
      teamExists: !!team,
      teamCids: team ? (team.cid_list || []) : null,
      hasTeamNeeds: team ? ('team_needs' in team) : null,
      teamMissing: team ? team.team_missing : null,
      memberUserExists: !!memberUser,
      memberOngoing: memberUser ? (memberUser.onGoing_cid || []) : null,
      myTeamsCount: (myTeams || []).length
    })
    // 【恢复真实功能时取消注释以下内容】
    if (!team) return { code: -1, msg: '队伍不存在' }
    const memberUids = Object.keys(team.members)
    if (memberUids.length >= team.maxNum) return { code: -1, msg: '人数已满' }
    if (team.members[uid]) return { code: -1, msg: '已在队内' }
    const teamCids = team.cid_list || []
    // 【修改】重复参赛判定基于“用户当前所属队伍覆盖的赛事”
    // onGoing_cid 是参赛记录（个人报名也会写入），不再作为重复参赛依据，避免误拦
    const myTeamCids = [...new Set((myTeams || []).flatMap(t => t.cid_list || []).map(Number))]
    const dupCids = teamCids.filter(c => myTeamCids.includes(Number(c)))
    if (dupCids.length > 0) {
      return { code: 2, msg: '您已有队伍参加该赛事，请勿重复加入' }
    }
    const memberOngoing = memberUser ? (memberUser.onGoing_cid || []) : []
    const mergedCnt = Array.from(new Set([...memberOngoing, ...teamCids])).length
    if (mergedCnt > MAX_ONGOING_CID) {
      return { code: 3, msg: `同时参赛最多${MAX_ONGOING_CID}场，已达上限` }
    }
    // 更新members并重新计算缺口（纯计算，恢复时保留）
    const newMembers = { ...team.members, [uid]: skillId }
    const newTeam = { ...team, members: newMembers }
    const newMissing = this.calcTeamMissing(newTeam)
    // 写库/有副作用调用（具体执行：注释）
    console.log('addMember v2 校验通过，newMissing =', newMissing)
    // 【修复】云开发 update 对 data 中值为空对象 {} 的字段不会真正覆盖原值（如 team_missing 旧值 {"1":1} 时不会被清空），
    // 必须用 _.set() 强制设置字段，才能让 newMissing={} 时真正把 team_missing 置空
    const updRes = await this.collection.where({ tid }).update({
      data: {
        members: newMembers,
        team_missing: _.set(newMissing)
      }
    })
    console.log('addMember v2 ① 更新 teams 完成', JSON.stringify(updRes))
    await this.addOnGoing(uid, teamCids)
    console.log('addMember v2 ② addOnGoing 完成')
    await this.userColl
      .where({ 'userInfo.uid': Number(uid) })
      .update({ data: { tid_list: _.addToSet(tid) } })
    console.log('addMember v2 ③ tid_list 完成')
    await this.removeUserPoolCids(uid, teamCids)
    console.log('addMember v2 ④ removeUserPoolCids 完成')
    await this.syncTeamPool(tid, newTeam, newMissing, true)
    console.log('addMember v2 ⑤ syncTeamPool 完成')
    if (teamCids.length > 0) {
      // 【修复】reqColl78 是笔误，正确集合引用是 this.reqColl（构造函数中定义为 requests 集合）
      try {
        await this.reqColl
          .where({ type: _.in(['apply', 'invite']), uid: Number(uid), status: 'pending', cid: _.in(teamCids) })
          .update({ data: { status: 'expired' } })
        console.log('addMember v2 ⑥ 清理 pending 请求完成')
      } catch (e) {
        // 【修复】requests 集合可能未创建（collection not exists），失效申请/邀请只是兜底清理，不应阻断入队主流程
        console.warn('addMember v2 清理 pending 请求失败（不影响入队）：', e.message)
      }
    }
    console.log('addMember v2 全部完成，返回加入成功')
    return { code: 0, msg: '加入成功' }
  }

  /**
   * 移除队员（不可踢队长）
   */
  async removeMember(tid, uid) {
    const team = await this.getByTid(tid)
    const uidNum = Number(uid)
    // 【修复】统一数字比较 + members 兜底，避免类型/缺失导致误判
    const members = team && team.members && typeof team.members === 'object' ? team.members : {}
    if (!team || Number(team.leader) === uidNum || !members[uidNum]) return false
    const newMembers = { ...members }
    delete newMembers[uidNum]
    const newTeam = { ...team, members: newMembers }
    const newMissing = this.calcTeamMissing(newTeam)
    console.log('[removeMember] tid=', tid, 'uid=', uidNum, 'before=', JSON.stringify(team.members), 'after=', JSON.stringify(newMembers), 'newMissing=', JSON.stringify(newMissing))
    // 【修复】空对象需用 _.set() 强制覆盖，否则 team_missing 旧值不会被清空
    // 【修复】members 同样用 _.set() 强制覆盖，避免云开发对异常情况下的 members 字段不更新
    await this.collection.where({ tid }).update({
      data: {
        members: _.set(newMembers),
        team_missing: _.set(newMissing)
      }
    })
    // 【新增】同步清理该成员 user.tid_list（退出/踢出共用此接口）
    await this.userColl
      .where({ 'userInfo.uid': Number(uid) })
      .update({ data: { tid_list: _.pull(tid) } })
    // 【新增】清理 onGoing_cid：该赛事若不再被其他队伍覆盖则移除
    for (const cid of (team.cid_list || [])) {
      await this.removeOnGoingIfNoOther(uid, tid, cid)
    }
    // 【新增】同步队伍匹配池：缺员后缺口变大，刷新池内缺口快照（保持可继续匹配）
    await this.syncTeamPool(tid, newTeam, newMissing, false)
    // 【新增】成员退出后队伍重新出现缺口且不在匹配池中 → 通知队长重新进入匹配池
    await this.notifyLeaderRejoin(newTeam, newMissing)
    return true
  }

  // ========== 【新增】指导老师 advisor ==========
  // teams.advisor: number[]（uid 数组）。指导老师不占 members，不参与匹配/参赛计数，
  // 入队仅：① 写入 teams.advisor ② 老师 user.tid_list 加入该 tid（便于老师在"我的队伍"看到）

  /**
   * 添加指导老师（队长邀请，老师在消息中心同意后由 requestApi.handle 调用）
   * @param {number} tid
   * @param {number} uid
   */
  async addAdvisor(tid, uid) {
    const team = await this.getByTid(tid)
    const uidNum = Number(uid)
    if (!team) return { code: -1, msg: '队伍不存在' }
    if (Number(team.leader) === uidNum) return { code: -1, msg: '队长不能作为指导老师' }
    const members = team.members || {}
    if (members[uidNum]) return { code: -1, msg: '该用户已是队伍成员，无需添加为指导老师' }
    const advisors = (team.advisor || []).map(Number)
    // 兼容旧单数 teacher_uid 字段
    if (team.teacher_uid) advisors.push(Number(team.teacher_uid))
    if (advisors.includes(uidNum)) return { code: -1, msg: '该指导老师已在队伍中' }
    // 校验用户存在且为老师角色（防越权：只有 teacher 能成为指导老师）
    const targetUser = await this.getUserByUid(uidNum)
    if (!targetUser) return { code: -1, msg: '用户不存在' }
    if (targetUser.role !== 'teacher') return { code: -1, msg: '仅老师（role=teacher）可担任指导老师' }
    // 写库：advisor 入列 + 老师 tid_list 关联
    await this.collection.where({ tid }).update({
      data: { advisor: _.addToSet(uidNum) }
    })
    await this.userColl.where({ 'userInfo.uid': uidNum }).update({
      data: { tid_list: _.addToSet(tid) }
    })
    return { code: 0, msg: '已添加指导老师' }
  }

  /**
   * 移除指导老师（仅队长）
   * @param {number} tid
   * @param {number} uid
   */
  async removeAdvisor(tid, uid) {
    const team = await this.getByTid(tid)
    const uidNum = Number(uid)
    if (!team) return { code: -1, msg: '队伍不存在' }
    const advisors = (team.advisor || []).map(Number)
    // 兼容旧单数 teacher_uid 字段
    const isOldTeacher = team.teacher_uid && Number(team.teacher_uid) === uidNum
    if (!advisors.includes(uidNum) && !isOldTeacher) return { code: -1, msg: '该用户不是指导老师' }
    const updateData = {}
    if (advisors.includes(uidNum)) {
      updateData.advisor = _.pull(uidNum)
    }
    if (isOldTeacher) {
      updateData.teacher_uid = _.remove()  // 清理旧单数字段
    }
    if (Object.keys(updateData).length > 0) {
      await this.collection.where({ tid }).update({ data: updateData })
    }
    // 同步移除老师 user.tid_list 中的该队伍（若该队伍仍与其成员身份无关）
    await this.userColl.where({ 'userInfo.uid': uidNum }).update({
      data: { tid_list: _.pull(tid) }
    })
    return { code: 0, msg: '已移除指导老师' }
  }

  /**
   * 【新增】队伍产生新缺口且不在匹配池中时，通知队长重新进入匹配池
   * 幂等：同一队伍已有待处理提醒则不重复创建（仅刷新时间），避免堆积
   * 通知失败不阻断退出主流程
   * @param {object} team 退出后的队伍对象
   * @param {object} newMissing 新缺口
   */
  async notifyLeaderRejoin(team, newMissing) {
    try {
      const tid = Number(team.tid)
      const leaderUid = Number(team.leader)
      if (!tid || !leaderUid) return
      const memberCount = Object.keys(team.members || {}).length
      const needRecruit = Object.keys(newMissing || {}).length > 0 && memberCount < team.maxNum
      if (!needRecruit) return
      // 队伍已在匹配池中：缺口快照已由 syncTeamPool 刷新，无需提醒
      const poolRes = await this.poolColl.where({ type: 'team', targetId: tid }).get()
      if (poolRes.data && poolRes.data[0]) return
      // 幂等：同队伍已有待处理提醒则不重复创建
      const exist = await this.reqColl
        .where({ type: 'notify', tid, uid: leaderUid, status: 'pending' })
        .get()
      const missingText = Object.entries(newMissing)
        .map(([sid, cnt]) => `技能${sid}缺${cnt}人`)
        .join('、')
      if (exist.data && exist.data.length > 0) {
        await this.reqColl.doc(exist.data[0]._id).update({
          data: { createTime: db.serverDate() }
        })
        return
      }
      await this.reqColl.add({
        data: {
          type: 'notify',
          tid,
          uid: leaderUid,
          cid: (team.cid_list && team.cid_list[0]) || null,
          skillId: null,
          status: 'pending',
          createTime: db.serverDate(),
          msg: `队伍「${team.name}」有成员退出，出现技能缺口（${missingText}），是否重新进入匹配池？`
        }
      })
    } catch (e) {
      console.warn('通知队长重新匹配失败（不影响退出流程）：', e.message)
    }
  }

  /**
   * 修改入队条件
   */
  async setCondition(tid, condition) {
    await this.collection.where({ tid }).update({
      data: { condition }
    })
    // 【新增】同步匹配池内 condition 快照
    const poolRes = await this.poolColl.where({ type: 'team', targetId: tid }).get()
    if (poolRes.data && poolRes.data[0]) {
      const doc = poolRes.data[0]
      const items = (doc.match_items || []).map(item => ({ ...item, condition }))
      await this.poolColl.doc(doc._id).update({ data: { match_items: items } })
    }
    return true
  }

  /**
   * 更新队伍基础信息（name/intro/maxNum等）
   */
  // async update(tid, newInfo) {
  //   await this.collection.where({ tid }).update({
  //     data: newInfo
  //   })
  //   return true
  // }
  async update(tid, newInfo) {
    const team = await this.getByTid(tid);
    if (!team) throw new Error('队伍不存在');
    const updateData = { ...newInfo };
    // 【新增】编辑时变更赛事列表：走 setTeamCidList 同步全体成员 onGoing_cid，避免重复参赛拦截失效
    if (Array.isArray(updateData.cid_list)) {
      const oldList = team.cid_list || [];
      const newList = updateData.cid_list;
      const changed = oldList.length !== newList.length || oldList.some((c, i) => c !== newList[i]);
      if (changed) {
        await this.setTeamCidList(tid, newList);
      }
      delete updateData.cid_list; // cid_list 已由 setTeamCidList 更新
    }
    // 如果更新了 team_needs，重新计算 team_missing
    if (newInfo.team_needs) {
      const tempTeam = { ...team, team_needs: newInfo.team_needs };
      updateData.team_missing = this.calcTeamMissing(tempTeam);
    }
    await this.collection.where({ tid }).update({ data: updateData });
    return true;
  }
  /**
   * 删除队伍
   */
  async delete(tid) {
    const team = await this.getByTid(tid)
    await this.collection.where({ tid }).remove()
    // 【新增】清空所有成员（含队长）user.tid_list
    if (team && team.members) {
      const uids = Object.keys(team.members).map(Number)
      if (uids.length > 0) {
        await this.userColl
          .where({ 'userInfo.uid': _.in(uids) })
          .update({ data: { tid_list: _.pull(tid) } })
        // 【新增】onGoing_cid 清理（每人检查是否还有其他队伍覆盖）
        for (const uid of uids) {
          for (const cid of (team.cid_list || [])) {
            await this.removeOnGoingIfNoOther(uid, tid, cid)
          }
        }
      }
    }
    // 【新增】清理匹配池中该队伍的记录，避免已解散队伍仍被推荐
    await this.poolColl.where({ type: 'team', targetId: tid }).remove()
    // 【新增】清理指导老师 user.tid_list 中的该队伍（advisor 不占 members，单独清理）
    if (team && team.advisor) {
      const advisorUids = team.advisor.map(Number)
      if (team.teacher_uid) advisorUids.push(Number(team.teacher_uid))
      const uniqueAdvisorUids = [...new Set(advisorUids)]
      if (uniqueAdvisorUids.length > 0) {
        await this.userColl
          .where({ 'userInfo.uid': _.in(uniqueAdvisorUids) })
          .update({ data: { tid_list: _.pull(tid) } })
      }
    }
    return true
  }
}

// 单例导出
module.exports = new TeamsService()