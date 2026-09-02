// requestApi/index.js
const cloud = require('wx-server-sdk')
const requestService = require('./service')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { action, params } = event
  try {
    let result
    switch (action) {
      // 创建邀请 / 申请
      case 'create':
        result = await requestService.create(params)
        return { code: 0, data: result, msg: '操作成功' }
      // 用户收到的邀请列表
      case 'getByUser':
        result = await requestService.getByUser(params.uid)
        return { code: 0, data: result, msg: '查询成功' }
      // 队伍收到的申请列表
      case 'getByTeam':
        result = await requestService.getByTeam(params.tid)
        return { code: 0, data: result, msg: '查询成功' }
      // 队长作为队长相关的待处理请求（我队伍收到的申请 + 我发出的邀请）
      case 'getByCaptain':
        result = await requestService.getByCaptain(params.uid)
        return { code: 0, data: result, msg: '查询成功' }
      // 处理请求（accept/reject）
      case 'handle':
        result = await requestService.handle(params)
        return result
      default:
        return { code: -99, msg: '未知操作action' }
    }
  } catch (err) {
    console.error('requestApi error:', err)
    return { code: -500, msg: err.message, error: err.message }
  }
}
