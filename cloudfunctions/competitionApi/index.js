// index.js
const cloud = require('wx-server-sdk')
const compService = require('./service')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  auth: 'ADMIN'
})

// ==================== 【安全】管理员校验（双通道，实现见 adminGuard.js） ====================
// ① 小程序端：OPENID（原逻辑）  ② Web 管理端：验签 event.adminToken
// 不能只依赖前端隐藏入口 —— 任何人都能直接 callFunction 伪造 action/params。
const { ensureAdmin } = require('./adminGuard')

exports.main = async (event, context) => {
  const { action, params } = event
  try {
    let res
    switch (action) {
      case 'getAll':
        res = await compService.getAll()
        return { code: 0, data: res, msg: 'success' }

      // 分页列表（管理端）：params { page, pageSize, keyword, status }
      case 'getPage':
        res = await compService.getPage(params || {})
        return { code: 0, data: res, msg: 'success' }

      // 按 cid 查单条赛事（管理端详情）
      case 'getByCid':
        res = await compService.getByCid(params.cid)
        if (!res) return { code: -404, msg: '赛事不存在' }
        return { code: 0, data: res, msg: 'success' }

      case 'create':
        if (!(await ensureAdmin(event))) return { code: -403, msg: '无管理员权限' }
        const newCid = await compService.create(params)
        return { code: 0, data: { cid: newCid }, msg: '创建成功' }

      case 'update':
        if (!(await ensureAdmin(event))) return { code: -403, msg: '无管理员权限' }
        await compService.update(params.cid, params)
        return { code: 0, msg: '更新成功' }

      case 'delete':
        if (!(await ensureAdmin(event))) return { code: -403, msg: '无管理员权限' }
        await compService.delete(params.cid)
        return { code: 0, msg: '删除成功' }

      case 'getFileTempUrl':
        res = await compService.getFileTempUrl(params.cidList, params.fieldType)
        return { code: 0, data: res, msg: '获取临时链接成功' }

      // 若需要 Word 转 HTML，保留 case
      case 'wordToHtml':
        res = await compService.wordToHtml(params.cid)
        return { code: 0, data: res, msg: 'Word转换完成' }

      // AI生成详情（管理员权限，防刷模型）
      // 【契约第 11 条】前端只传 cid，name / url 由 service 从库内记录取，
      // 避免调用方传入与赛事不匹配的名称/官网被写进 content
      case 'aiGenDetail':
        if (!(await ensureAdmin(event))) return { code: -403, msg: '无管理员权限' }
        console.log("进入云函数分派");
        const cid = Number(params.cid); 
        const content = await compService.aiGenerateDetail(cid)
        return { code: 0, data: { content }, msg: 'AI生成赛事详情成功' }
      
      default:
        return { code: -99, msg: '未知 action' }
    }
  } catch (err) {
    console.error('competitionApi error:', err)
    // status=400 是 service 层抛出的"参数校验失败"（白名单 / 必填 / 长度 / 日期）:
    // 属于客户端用错，把 msg 原样回给前端，别埋进"服务器异常"里让用户看不懂
    const isBadRequest = err && err.status === 400
    return {
      code: isBadRequest ? -400 : -500,
      msg: isBadRequest ? err.message : '服务器异常',
      error: err.message,
    }
  }
}