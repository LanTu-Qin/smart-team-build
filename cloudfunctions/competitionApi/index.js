// index.js
const cloud = require('wx-server-sdk')
const compService = require('./service')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  auth: 'ADMIN'
})

// 【新增】校验调用者是否为管理员（user 集合 isAdmin === true）
// 云函数默认信任客户端，必须在此二次校验，防止绕过前端入口直接调用
async function ensureAdmin() {
  const { OPENID } = cloud.getWXContext()
  const db = cloud.database()
  try {
    const res = await db.collection('user').where({ _openid: OPENID }).get()
    return !!(res.data[0] && res.data[0].isAdmin)
  } catch (e) {
    console.error('校验管理员权限异常', e)
    return false
  }
}

exports.main = async (event, context) => {
  const { action, params } = event
  try {
    let res
    switch (action) {
      case 'getAll':
        res = await compService.getAll()
        return { code: 0, data: res, msg: 'success' }

      case 'create':
        if (!(await ensureAdmin())) return { code: -403, msg: '无管理员权限' }
        const newCid = await compService.create(params)
        return { code: 0, data: { cid: newCid }, msg: '创建成功' }

      case 'update':
        if (!(await ensureAdmin())) return { code: -403, msg: '无管理员权限' }
        await compService.update(params.cid, params)
        return { code: 0, msg: '更新成功' }

      case 'delete':
        if (!(await ensureAdmin())) return { code: -403, msg: '无管理员权限' }
        await compService.delete(params.cid)
        return { code: 0, msg: '删除成功' }

      case 'getFileTempUrl':
        res = await compService.getFileTempUrl(params.cidList, params.fieldType)
        return { code: 0, data: res, msg: '获取临时链接成功' }

      // 若需要 Word 转 HTML，保留 case
      case 'wordToHtml':
        res = await compService.wordToHtml(params.cid)
        return { code: 0, data: res, msg: 'Word转换完成' }

      // AI生成详情：仅转发参数给service（管理员权限，防刷模型）
      case 'aiGenDetail':
        if (!(await ensureAdmin())) return { code: -403, msg: '无管理员权限' }
        console.log("进入云函数分派");
        const cid = Number(params.cid); 
        const { name, url } = params
        const content = await compService.aiGenerateDetail(cid, name, url)
        return { code: 0, data: { content }, msg: 'AI生成赛事详情成功' }
      
      default:
        return { code: -99, msg: '未知 action' }
    }
  } catch (err) {
    console.error('competitionApi error:', err)
    return { code: -500, msg: '服务器异常', error: err.message }
  }
}