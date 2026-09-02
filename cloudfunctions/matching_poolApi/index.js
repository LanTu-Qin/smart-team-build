// matchApi/index.js
const cloud = require('wx-server-sdk')
const matchService = require('./service')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { action, params } = event
  try {
    let result
    switch (action) {
      // 开启匹配、入池
      case 'enterPool':
        result = await matchService.enterPool(params)
        return { code: 0, data: result, msg: '成功进入匹配池' }
      // 关闭匹配、出池
      case 'exitPool':
        result = await matchService.exitPool(params)
        return { code: 0, data: result, msg: '已退出匹配池' }
      // 获取弹窗匹配推荐列表
      case 'getMatchList':
        const list = await matchService.getMatchList(params)
        return { code: 0, data: list, msg: '查询成功' }
      // 【新增】查询当前用户的个人匹配池记录
      case 'getMyPool':
        const myPool = await matchService.getMyPool(params && params.uid)
        return { code: 0, data: myPool, msg: '查询成功' }
      default:
        return { code: -99, msg: '未知匹配操作action' }
    }
  } catch (err) {
    console.error('matchApi error：', err)
    return {
      code: -500,
      msg: err.message || '匹配服务异常',
      error: err.message
    }
  }
}
