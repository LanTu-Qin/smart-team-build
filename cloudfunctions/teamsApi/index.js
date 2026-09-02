// teamsApi/index.js
const cloud = require('wx-server-sdk')
const teamsService = require('./service')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 云函数入口
 * @param {Object} event
 * @param {string} event.action 操作类型
 */
exports.main = async (event, context) => {
  const { action, params } = event
  try {
    let res
    switch (action) {
      // 获取全部队伍
      case 'getList':
        res = await teamsService.getList()
        console.log("teamAPI:",res);
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
      // 创建队伍
      case 'create':
        const createRes = await teamsService.create(params.teamInfo)
        if (createRes.code !== 0) return createRes
        return { code: 0, data: { tid: createRes.data.tid }, msg: '创建成功' }
      // 添加队员
      case 'addMember':
        const addRes = await teamsService.addMember(params.tid, params.uid, params.skillId)
        return addRes
      // 移除队员
      case 'removeMember':
        const delOk = await teamsService.removeMember(params.tid, params.uid)
        return delOk
          ? { code: 0, msg: '移除成功' }
          : { code: -1, msg: '移除失败，不存在或为队长' }
      // 添加指导老师
      case 'addAdvisor':
        return await teamsService.addAdvisor(params.tid, params.uid)
      // 移除指导老师
      case 'removeAdvisor':
        return await teamsService.removeAdvisor(params.tid, params.uid)
      // 设置招募需求
      case 'setTeamNeeds':
        const needRes = await teamsService.setTeamNeeds(params.tid, params.newNeeds)
        return needRes
      // 修改匹配状态
      case 'setMatchStatus':
        const matchOk = await teamsService.setMatchStatus(params.tid, params.status)
        return matchOk
          ? { code: 0, msg: '修改成功' }
          : { code: -1, msg: '队伍不存在' }
      // 新增赛事cid
      case 'addTeamCid':
        await teamsService.addTeamCid(params.tid, params.cid)
        return { code: 0, msg: '添加赛事成功' }
      // 删除赛事cid
      case 'removeTeamCid':
        await teamsService.removeTeamCid(params.tid, params.cid)
        return { code: 0, msg: '移除赛事成功' }
      // 批量替换cid列表
      case 'setTeamCidList':
        await teamsService.setTeamCidList(params.tid, params.cidList)
        return { code: 0, msg: '更新赛事列表成功' }
      // 修改入队条件
      case 'setCondition':
        await teamsService.setCondition(params.tid, params.condition)
        return { code: 0, msg: '条件修改成功' }
      // 更新队伍基础信息
      case 'update':
        await teamsService.update(params.tid, params.newInfo)
        return { code: 0, msg: '信息更新成功' }
      // 删除队伍
      case 'delete':
        await teamsService.delete(params.tid)
        return { code: 0, msg: '队伍已删除' }
      default:
        return { code: -99, msg: '未知操作action' }
    }
  } catch (err) {
    console.error('teamsApi error:', err)
    return { code: -500, msg: '服务器异常', error: err.message }
  }
}