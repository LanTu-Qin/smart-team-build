// // 导入所有子模块
// const competition = require('./competition')
// const user = require('./user')
// const skills = require('./skills')
// const teams = require('./teams')
// // 全局监听队列
// const listeners = []
// // 全局根Store
// const store = {
//   competition,
//   user,
//   skills,
//   teams,
//   // 注册监听：数据变化时触发回调
//   subscribe(cb) {
//     listeners.push(cb)
//   },
//   // 触发所有监听（数据更新后调用）
//   notify() {
//     listeners.forEach(fn => fn(store))
//   }
// }

// // ========== 竞赛模块劫持（补齐异步云函数劫持） ==========
// const originSetList = competition.setList
// competition.setList = function (newList) {
//   originSetList.call(this, newList)
//   store.notify()
// }
// const originSetBanner = competition.setBanner
// competition.setBanner = function (newBanner) {
//   originSetBanner.call(this, newBanner)
//   store.notify()
// }
// // 新增竞赛异步劫持
// const originLoadComp = competition.loadCompetition
// competition.loadCompetition = async function () {
//   const res = await originLoadComp.call(this)
//   store.notify()
//   return res
// }
// const originAddComp = competition.addComp
// competition.addComp = async function (info) {
//   const res = await originAddComp.call(this, info)
//   store.notify()
//   return res
// }
// const originUpdateComp = competition.updateComp
// competition.updateComp = async function (cid, info) {
//   const res = await originUpdateComp.call(this, cid, info)
//   store.notify()
//   return res
// }
// const originDeleteComp = competition.deleteComp
// competition.deleteComp = async function (cid) {
//   const res = await originDeleteComp.call(this, cid)
//   store.notify()
//   return res
// }
// // ===== 新增：劫持aiGenerateDetail，修复this、自动notify刷新视图 =====
// const originAiGenDetail = competition.aiGenerateDetail
// competition.aiGenerateDetail = async function (cid, name, url) {
//   // call绑定当前competition对象this，避免内部this丢失报错
//   const res = await originAiGenDetail.call(this, cid, name, url)
//   store.notify()
//   return res
// }

// // ========== User用户模块劫持（无遗漏，保留原有） ==========
// const originSetLogin = user.setLogin
// user.setLogin = function (flag) {
//   originSetLogin.call(this, flag)
//   store.notify()
// }
// const originSetAdmin = user.setAdmin
// user.setAdmin = function (isAdmin) {
//   originSetAdmin.call(this, isAdmin)
//   store.notify()
// }
// const originSetName = user.setName
// user.setName = function (name) {
//   originSetName.call(this, name)
//   store.notify()
// }
// const originAddSkill = user.addSkill
// user.addSkill = function (sid) {
//   originAddSkill.call(this, sid)
//   store.notify()
// }
// const originRemoveSkill = user.removeSkill
// user.removeSkill = function (sid) {
//   originRemoveSkill.call(this, sid)
//   store.notify()
// }
// const originClearSkills = user.clearSkills
// user.clearSkills = function () {
//   originClearSkills.call(this)
//   store.notify()
// }

// const originSetTid = user.setTid
// user.setTid = async function (tid) {
//   const result = await originSetTid.call(this, tid)  // 保存
//   store.notify()
//   return result  // 返回给调用方
// }

// const originRemoveTid = user.removeTid
// user.removeTid = async function (tid) {
//   const result = await originRemoveTid.call(this, tid)
//   store.notify()
//   return result
// }

// const originSetTidList = user.setTidList
// user.setTidList = async function (tidArr) {
//   const result = await originSetTidList.call(this, tidArr)
//   store.notify()
//   return result
// }

// const originUserSetMatchStatus = user.setMatchStatus
// user.setMatchStatus = function (isMatch) {
//   originUserSetMatchStatus.call(this, isMatch)
//   store.notify()
// }
// const originLogin = user.login
// user.login = function (userInfo) {
//   originLogin.call(this, userInfo)
//   store.notify()
// }
// const originLogout = user.logout
// user.logout = function () {
//   originLogout.call(this)
//   store.notify()
// }

// // ========== Skills技能字典模块劫持（原有正确，保留） ==========
// const originLoadSkills = skills.loadSkills
// skills.loadSkills = async function() {
//   const res = await originLoadSkills.call(this)
//   store.notify()
//   return res
// }
// const originAddNewSkill = skills.addSkill
// skills.addSkill = async function (name) {
//   const res = await originAddNewSkill.call(this, name)
//   store.notify()
//   return res
// }

// // ========== teams 模块【全部重写异步劫持，删除旧同步劫持】 ==========
// // 1. 全局加载所有队伍（核心必加）
// const originLoadAllTeams = teams.loadAllTeams
// teams.loadAllTeams = async function () {
//   const res = await originLoadAllTeams.call(this)
//   store.notify()
//   return res
// }
// // 2. 创建队伍
// const originCreateTeam = teams.createTeam
// teams.createTeam = async function (info) {
//   const res = await originCreateTeam.call(this, info)
//   store.notify()
//   return res
// }
// // 3. 添加队员
// const originAddMember = teams.addMember
// teams.addMember = async function (tid, uid, sid) {
//   const res = await originAddMember.call(this, tid, uid, sid)
//   store.notify()
//   return res
// }
// // 4. 移除队员
// const originRemoveMember = teams.removeMember
// teams.removeMember = async function (tid, uid) {
//   const res = await originRemoveMember.call(this, tid, uid)
//   store.notify()
//   return res
// }
// // 5. 修改队伍基础信息
// const originUpdateTeam = teams.updateTeam
// teams.updateTeam = async function (tid, info) {
//   const res = await originUpdateTeam.call(this, tid, info)
//   store.notify()
//   return res
// }
// // 6. 删除队伍
// const originDeleteTeam = teams.deleteTeam
// teams.deleteTeam = async function (tid) {
//   const res = await originDeleteTeam.call(this, tid)
//   store.notify()
//   return res
// }
// // 7. 设置招募需求
// const originSetTeamNeeds = teams.setTeamNeeds
// teams.setTeamNeeds = async function (tid, needs) {
//   const res = await originSetTeamNeeds.call(this, tid, needs)
//   store.notify()
//   return res
// }
// // 8. 修改匹配状态
// const originSetMatchStatus = teams.setMatchStatus
// teams.setMatchStatus = async function (tid, status) {
//   const res = await originSetMatchStatus.call(this, tid, status)
//   store.notify()
//   return res
// }
// // 9. 新增赛事cid
// const originAddTeamCid = teams.addTeamCid
// teams.addTeamCid = async function (tid, cid) {
//   const res = await originAddTeamCid.call(this, tid, cid)
//   store.notify()
//   return res
// }
// // 10. 移除赛事cid
// const originRemoveTeamCid = teams.removeTeamCid
// teams.removeTeamCid = async function (tid, cid) {
//   const res = await originRemoveTeamCid.call(this, tid, cid)
//   store.notify()
//   return res
// }
// // 11. 批量替换cid列表
// const originSetTeamCidList = teams.setTeamCidList
// teams.setTeamCidList = async function (tid, list) {
//   const res = await originSetTeamCidList.call(this, tid, list)
//   store.notify()
//   return res
// }
// // 12. 修改入队条件
// const originSetCondition = teams.setCondition
// teams.setCondition = async function (tid, cond) {
//   const res = await originSetCondition.call(this, tid, cond)
//   store.notify()
//   return res
// }

// module.exports = store

// store/index.js
const competition = require('./competition')
const user = require('./user')
const skills = require('./skills')
const teams = require('./teams')

// 分模块监听池：key=模块名 competition/user/skills/teams
const moduleListeners = {
  competition: [],
  user: [],
  skills: [],
  teams: []
}

// 全局根Store
const store = {
  competition,
  user,
  skills,
  teams,

  // 【兼容旧代码】全局订阅（不推荐页面使用）
  subscribe(cb) {
    Object.values(moduleListeners).forEach(list => list.push(cb))
  },
  // 【兼容旧代码】全局通知
  notify() {
    Object.values(moduleListeners).flat().forEach(fn => fn(store))
  },

  // ========== 新增：模块级订阅/通知（页面统一用这个） ==========
  /**
   * 订阅指定模块变更
   * @param {string} moduleName 模块名 teams/competition/user/skills
   * @param {Function} cb 回调
   * @returns {Function} 取消订阅函数
   */
  subscribeModule(moduleName, cb) {
    if (!moduleListeners[moduleName]) throw new Error('模块不存在')
    moduleListeners[moduleName].push(cb)
    // 返回取消订阅方法
    return () => {
      const arr = moduleListeners[moduleName]
      const idx = arr.indexOf(cb)
      if (idx > -1) arr.splice(idx, 1)
    }
  },
  /**
   * 仅通知指定模块的监听者
   * @param {string} moduleName
   */
  notifyModule(moduleName) {
    moduleListeners[moduleName].forEach(fn => fn(store))
  }
}

// ===================== 劫持改造重点 =====================
// 所有模块劫持，把原来 store.notify() 替换为 store.notifyModule('模块名')

// 1. competition 模块劫持
const originSetList = competition.setList
competition.setList = function (newList) {
  originSetList.call(this, newList)
  store.notifyModule('competition')
}
const originSetBanner = competition.setBanner
competition.setBanner = function (newBanner) {
  originSetBanner.call(this, newBanner)
  store.notifyModule('competition')
}
const originLoadComp = competition.loadCompetition
competition.loadCompetition = async function () {
  const res = await originLoadComp.call(this)
  store.notifyModule('competition')
  return res
}
const originAddComp = competition.addComp
competition.addComp = async function (info) {
  const res = await originAddComp.call(this, info)
  store.notifyModule('competition')
  return res
}
const originUpdateComp = competition.updateComp
competition.updateComp = async function (opts) {
  const res = await originUpdateComp.call(this, opts)
  store.notifyModule('competition')
  return res
}
const originDeleteComp = competition.deleteComp
competition.deleteComp = async function (cid) {
  const res = await originDeleteComp.call(this, cid)
  store.notifyModule('competition')
  return res
}
const originAiGenDetail = competition.aiGenerateDetail
competition.aiGenerateDetail = async function (cid, name, url) {
  const res = await originAiGenDetail.call(this, cid, name, url)
  store.notifyModule('competition')
  return res
}

// 2. user 模块劫持
const originSetLogin = user.setLogin
user.setLogin = function (flag) {
  originSetLogin.call(this, flag)
  store.notifyModule('user')
}
const originSetAdmin = user.setAdmin
user.setAdmin = function (isAdmin) {
  originSetAdmin.call(this, isAdmin)
  store.notifyModule('user')
}
const originSetName = user.setName
user.setName = function (name) {
  originSetName.call(this, name)
  store.notifyModule('user')
}
const originAddSkill = user.addSkill
user.addSkill = function (sid) {
  originAddSkill.call(this, sid)
  store.notifyModule('user')
}
const originRemoveSkill = user.removeSkill
user.removeSkill = function (sid) {
  originRemoveSkill.call(this, sid)
  store.notifyModule('user')
}
const originClearSkills = user.clearSkills
user.clearSkills = function () {
  originClearSkills.call(this)
  store.notifyModule('user')
}
const originSetTid = user.setTid
user.setTid = async function (tid) {
  const result = await originSetTid.call(this, tid)
  store.notifyModule('user')
  return result
}
const originRemoveTid = user.removeTid
user.removeTid = async function (tid) {
  const result = await originRemoveTid.call(this, tid)
  store.notifyModule('user')
  return result
}
const originSetTidList = user.setTidList
user.setTidList = async function (tidArr) {
  const result = await originSetTidList.call(this, tidArr)
  store.notifyModule('user')
  return result
}
const originUserSetMatchStatus = user.setMatchStatus
user.setMatchStatus = function (isMatch) {
  originUserSetMatchStatus.call(this, isMatch)
  store.notifyModule('user')
}
const originLogin = user.login
user.login = function (userInfo) {
  originLogin.call(this, userInfo)
  store.notifyModule('user')
}
const originLogout = user.logout
user.logout = function () {
  originLogout.call(this)
  store.notifyModule('user')
}

// 3. skills 模块劫持
const originLoadSkills = skills.loadSkills
skills.loadSkills = async function() {
  const res = await originLoadSkills.call(this)
  store.notifyModule('skills')
  return res
}
const originAddNewSkill = skills.addSkill
// 用 call 透传固定参数：避免 ...args 被 swc 转译成 new Array() 产生数组空位，
// 触发 @swc/runtime/_array_with_holes.js 缺失导致页面加载崩溃。
skills.addSkill = async function (name, desc) {
  const res = await originAddNewSkill.call(this, name, desc)
  store.notifyModule('skills')
  return res
}

// 4. teams 模块劫持（关键！队伍页面只监听这个模块）
const originLoadAllTeams = teams.loadAllTeams
teams.loadAllTeams = async function () {
  const res = await originLoadAllTeams.call(this)
  store.notifyModule('teams')
  return res
}
const originCreateTeam = teams.createTeam
teams.createTeam = async function (info) {
  const res = await originCreateTeam.call(this, info)
  store.notifyModule('teams')
  return res
}
const originAddMember = teams.addMember
teams.addMember = async function (tid, uid, sid) {
  const res = await originAddMember.call(this, tid, uid, sid)
  store.notifyModule('teams')
  return res
}
const originRemoveMember = teams.removeMember
teams.removeMember = async function (tid, uid) {
  const res = await originRemoveMember.call(this, tid, uid)
  store.notifyModule('teams')
  return res
}
const originUpdateTeam = teams.updateTeam
teams.updateTeam = async function (tid, info) {
  const res = await originUpdateTeam.call(this, tid, info)
  store.notifyModule('teams')
  return res
}
const originDeleteTeam = teams.deleteTeam
teams.deleteTeam = async function (tid) {
  const res = await originDeleteTeam.call(this, tid)
  store.notifyModule('teams')
  return res
}
const originSetTeamNeeds = teams.setTeamNeeds
teams.setTeamNeeds = async function (tid, needs) {
  const res = await originSetTeamNeeds.call(this, tid, needs)
  store.notifyModule('teams')
  return res
}
const originSetMatchStatus = teams.setMatchStatus
teams.setMatchStatus = async function (tid, status) {
  const res = await originSetMatchStatus.call(this, tid, status)
  store.notifyModule('teams')
  return res
}
const originAddTeamCid = teams.addTeamCid
teams.addTeamCid = async function (tid, cid) {
  const res = await originAddTeamCid.call(this, tid, cid)
  store.notifyModule('teams')
  return res
}
const originRemoveTeamCid = teams.removeTeamCid
teams.removeTeamCid = async function (tid, cid) {
  const res = await originRemoveTeamCid.call(this, tid, cid)
  store.notifyModule('teams')
  return res
}
const originSetTeamCidList = teams.setTeamCidList
teams.setTeamCidList = async function (tid, list) {
  const res = await originSetTeamCidList.call(this, tid, list)
  store.notifyModule('teams')
  return res
}
const originSetCondition = teams.setCondition
teams.setCondition = async function (tid, cond) {
  const res = await originSetCondition.call(this, tid, cond)
  store.notifyModule('teams')
  return res
}

module.exports = store
