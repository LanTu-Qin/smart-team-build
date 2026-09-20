// teamsApi/index.js
const cloud = require('wx-server-sdk')
const teamsService = require('./service')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// ==================== 【安全】调用者身份 + 队伍操作权限校验 ====================
// 背景：本函数是 C 端入口，delete / removeMember / update / setCondition / setTeamNeeds 等
//       此前只信任客户端传来的 tid / uid，任何人可伪造参数改删他人队伍。
// 根治方案：cloud.getWXContext() 取 OPENID → 查 user 集合拿真实 uid → 与 team.leader 比对。
// 权限矩阵：队长 = 全部写权限；管理员 = 与队长同等（便于后台处置违规队伍）；
//           成员本人 = 仅可加入/退出自己；指导老师 = 仅可解除自己的指导关系。

// ==================== 【安全】管理员校验（双通道，实现见 adminGuard.js） ====================
// 本函数同时服务 C 端小程序与 Web 管理端：
//   ① 小程序端：OPENID（原逻辑）  ② Web 管理端：验签 event.adminToken
// 不能只依赖前端入口隐藏按钮 —— 任何人都能直接 callFunction 伪造 action/params。
const { ensureAdmin } = require('./adminGuard')

/** 解析调用者身份；无 OPENID（云端控制台/网关直调）或用户不存在时返回 null */
async function getCaller() {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return null
  try {
    const res = await cloud.database().collection('user').where({ _openid: OPENID }).get()
    const u = res.data[0]
    if (!u) return null
    const rawUid = u.userInfo ? u.userInfo.uid : null
    const uid = (rawUid === undefined || rawUid === null) ? null : Number(rawUid)
    return { openid: OPENID, uid, isAdmin: !!u.isAdmin, role: u.role || '' }
  } catch (e) {
    console.error('[teamsApi] 解析调用者身份异常', e)
    return null
  }
}

/** 未登录 / 未完善资料（uid 为空或 <=0，即 uid=-1 临时用户）的统一拦截 */
function requireCaller(caller) {
  if (!caller) {
    return { code: -401, msg: '无法识别调用者身份，请在小程序端登录后操作' }
  }
  if (caller.uid === null || isNaN(caller.uid) || Number(caller.uid) <= 0) {
    return { code: -401, msg: '请先完善个人资料（绑定学号/工号）后再操作' }
  }
  return null
}

/**
 * 队伍操作权限判定
 * @param {number} tid 队伍 ID
 * @param {object} caller getCaller() 的结果
 * @param {object} opts
 *   allowSelf        允许"操作对象是本人"（本人加入/退出队伍），需配合 selfUid
 *   selfUid          被操作者 uid（配合 allowSelf）
 *   allowAdvisorSelf 允许指导老师解除自己的指导关系
 * @returns {{ok:boolean, code:number, msg?:string, team?:object, isLeader, isAdvisor, isAdmin}}
 */
async function checkTeamPerm(tid, caller, opts = {}) {
  const { allowSelf = false, selfUid = null, allowAdvisorSelf = false } = opts || {}
  const deny = requireCaller(caller)
  if (deny) return Object.assign({ ok: false, team: null }, deny)

  const teamRes = await cloud.database().collection('teams').where({ tid: Number(tid) }).get()
  const team = teamRes.data[0]
  if (!team) return { ok: false, code: -1, msg: '队伍不存在', team: null }

  const uid = Number(caller.uid)
  // 兼容旧单数 teacher_uid 字段
  const advisors = (team.advisor || []).map(Number)
  if (team.teacher_uid) advisors.push(Number(team.teacher_uid))

  const isLeader = Number(team.leader) === uid
  const isAdmin = !!caller.isAdmin
  const isAdvisor = advisors.includes(uid)
  const isSelf = allowSelf && selfUid !== null && selfUid !== undefined && Number(selfUid) === uid
  const identity = { team, isLeader, isAdvisor, isAdmin, isSelf }

  if (isLeader || isAdmin) return Object.assign({ ok: true, code: 0 }, identity)
  if (isSelf) return Object.assign({ ok: true, code: 0 }, identity)
  if (allowAdvisorSelf && isAdvisor) return Object.assign({ ok: true, code: 0 }, identity)

  return Object.assign({
    ok: false,
    code: -403,
    msg: '无权限操作该队伍（仅队长/管理员可操作）'
  }, identity)
}

/**
 * 云函数入口
 * @param {Object} event
 * @param {string} event.action 操作类型
 */
exports.main = async (event, context) => {
  const { action, params } = event
  // 调用者身份懒加载：仅写操作触发查库，读接口零额外开销
  let caller = null
  let callerLoaded = false
  const loadCaller = async () => {
    if (!callerLoaded) {
      caller = await getCaller()
      callerLoaded = true
    }
    return caller
  }
  try {
    let res
    switch (action) {
      // 获取全部队伍
      case 'getList':
        res = await teamsService.getList()
        console.log("teamAPI:",res);
        return { code: 0, data: res, msg: 'success' }
      // 分页查询队伍（管理端）：params { page, pageSize, cid }
      case 'getPage':
        res = await teamsService.getPage(params || {})
        return { code: 0, data: res, msg: 'success' }
      // 根据tid查单支队伍
      case 'getByTid':
        res = await teamsService.getByTid(params.tid)
        return { code: 0, data: res, msg: 'success' }
      // 根据赛事cid查队伍
      case 'getByCid':
        res = await teamsService.getByCid(params.cid)
        return { code: 0, data: res, msg: 'success' }
      // 根据用户uid查所属队伍
      case 'getByUid':
        res = await teamsService.getByUid(params.uid)
        return { code: 0, data: res, msg: 'success' }
      // 创建队伍（队长必须是调用者本人，防冒用他人 uid 建队）
      case 'create': {
        const c = await loadCaller()
        const deny = requireCaller(c)
        if (deny) return deny
        const teamInfo = Object.assign({}, params.teamInfo)
        if (Number(teamInfo.leader) !== Number(c.uid)) {
          return { code: -403, msg: '无权限以他人身份创建队伍' }
        }
        // 【成员伪造修复｜2026-09-15】members 只认队长本人：其余成员必须经 addMember / 申请 / 邀请进入。
        // 此前 members 由客户端原样落库，可伪造他人 uid 进成员名单（虚增成员、挤占 maxNum 名额、
        // 影响 team_missing 与匹配展示）。
        // 已核对 C 端仅有的两处创建入口（team_push.js 常规建队、competition_info.js 个人赛报名）
        // 都只传 { [uid]: 技能sid }，因此收窄为零兼容风险。
        const rawMembers = teamInfo.members || {}
        const rawLeaderSkill = rawMembers[String(c.uid)] !== undefined
          ? rawMembers[String(c.uid)]
          : rawMembers[c.uid]
        // 兜底 0 与 requestApi.create 的 skillId 默认值口径一致；calcTeamMissing 只按技能计数，0 无副作用
        teamInfo.members = {
          [String(c.uid)]: rawLeaderSkill === undefined || rawLeaderSkill === null ? 0 : rawLeaderSkill
        }
        const createRes = await teamsService.create(teamInfo)
        if (createRes.code !== 0) return createRes
        return { code: 0, data: { tid: createRes.data.tid }, msg: '创建成功' }
      }
      // 添加队员（队长添加他人 / 本人主动加入；两者之外的 uid 一律拒绝）
      case 'addMember': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c, { allowSelf: true, selfUid: params.uid })
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        // 【业务绕过】本人自助加入只对"自由加入"(0) 开放：
        // 审核加入(1)/仅邀请(2) 必须走 requestApi 申请或队长邀请，否则任何人都能绕过审核直接进队。
        // 口径与小程序端 conditionText 一致：非 1/2（含未设置 condition 的旧数据）视为无限制。
        const cond = Number(perm.team.condition)
        if (perm.isSelf && !perm.isLeader && !perm.isAdmin && (cond === 1 || cond === 2)) {
          return { code: -403, msg: '该队伍需要申请或邀请才能加入，请走申请流程' }
        }
        const addRes = await teamsService.addMember(params.tid, params.uid, params.skillId)
        return addRes
      }
      // 移除队员（队长踢人 / 本人主动退出；队长本身不可被移除，由 service 兜底）
      case 'removeMember': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c, { allowSelf: true, selfUid: params.uid })
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        const delOk = await teamsService.removeMember(params.tid, params.uid)
        return delOk
          ? { code: 0, msg: '移除成功' }
          : { code: -1, msg: '移除失败，不存在或为队长' }
      }
      // 添加指导老师（仅队长/管理员；目标须为 teacher 角色，由 service 校验）
      case 'addAdvisor': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c)
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        return await teamsService.addAdvisor(params.tid, params.uid)
      }
      // 移除指导老师（队长/管理员移除任意老师；老师仅能解除自己的指导关系）
      case 'removeAdvisor': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c, { allowAdvisorSelf: true })
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        // 【越权】allowAdvisorSelf 只代表"你是该队指导老师"，不等于能移除别人：
        // 非队长/管理员的老师只能解除自己，否则 A 老师可把 B 老师踢掉。
        if (!perm.isLeader && !perm.isAdmin && Number(params.uid) !== Number(c.uid)) {
          return { code: -403, msg: '只能解除自己的指导关系' }
        }
        return await teamsService.removeAdvisor(params.tid, params.uid)
      }
      // 设置招募需求（仅队长/管理员）
      case 'setTeamNeeds': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c)
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        const needRes = await teamsService.setTeamNeeds(params.tid, params.newNeeds)
        return needRes
      }
      // 修改匹配状态（仅队长/管理员）
      case 'setMatchStatus': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c)
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        const matchOk = await teamsService.setMatchStatus(params.tid, params.status)
        return matchOk
          ? { code: 0, msg: '修改成功' }
          : { code: -1, msg: '队伍不存在' }
      }
      // 新增赛事cid（仅队长/管理员）
      case 'addTeamCid': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c)
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        await teamsService.addTeamCid(params.tid, params.cid)
        return { code: 0, msg: '添加赛事成功' }
      }
      // 删除赛事cid（仅队长/管理员）
      case 'removeTeamCid': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c)
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        await teamsService.removeTeamCid(params.tid, params.cid)
        return { code: 0, msg: '移除赛事成功' }
      }
      // 批量替换cid列表（仅队长/管理员）
      case 'setTeamCidList': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c)
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        await teamsService.setTeamCidList(params.tid, params.cidList)
        return { code: 0, msg: '更新赛事列表成功' }
      }
      // 修改入队条件（仅队长/管理员）
      case 'setCondition': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c)
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        await teamsService.setCondition(params.tid, params.condition)
        return { code: 0, msg: '条件修改成功' }
      }
      // 更新队伍基础信息（仅队长/管理员）
      case 'update': {
        const c = await loadCaller()
        const perm = await checkTeamPerm(params.tid, c)
        if (!perm.ok) return { code: perm.code, msg: perm.msg }
        await teamsService.update(params.tid, params.newInfo)
        return { code: 0, msg: '信息更新成功' }
      }
      // 删除队伍（C 端：队长可解散自己的队伍；管理员：可删任意队伍）
      case 'delete': {
        const c = await loadCaller()
        if (c) {
          // 有 OPENID：一次查库同时拿到 uid 与 isAdmin（checkTeamPerm 内已含管理员放行），
          // 不再重复走 ensureAdmin，避免同一个 user 文档查两遍
          const perm = await checkTeamPerm(params.tid, c)
          if (!perm.ok) return { code: perm.code, msg: perm.msg }
        } else {
          // 无 OPENID（Web 管理端/网关直调）：才单独走 ensureAdmin，与 competitionApi 口径一致。
          // 【2026-09-19 更新】ensureAdmin 已是双通道：无 OPENID 时验签 event.adminToken
          //   （HMAC 自签 → uid → 重读 isAdmin → 比对 adminTokenVersion）。
          //   已实测：Web 端匿名登录调用时 getWXContext().OPENID 为空，因此确实走 adminToken 分支。
          if (!(await ensureAdmin(event))) {
            return { code: -403, msg: '无权限删除该队伍（仅队长或管理员）' }
          }
        }
        await teamsService.delete(params.tid)
        return { code: 0, msg: '队伍已删除' }
      }
      default:
        return { code: -99, msg: '未知操作action' }
    }
  } catch (err) {
    console.error('teamsApi error:', err)
    return { code: -500, msg: '服务器异常', error: err.message }
  }
}