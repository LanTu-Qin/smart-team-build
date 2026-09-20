// cloudfunctions/adminAuth/index.js
// ============================================================================
// 管理端认证（路由型）：action = login / me / setPassword / changePassword
// ----------------------------------------------------------------------------
// 【职责边界】本函数只负责「证明你是管理员」：
//   校验账号密码（bcrypt）→ 签发自研 adminToken。
//   真正的权限判定（isAdmin）与令牌版本校验，在各业务云函数的 ensureAdmin() 里执行。
//
// 【为什么不用平台自定义登录】自定义登录要生成/保管私钥、还要平台注入 Web 身份，
//   未知项多；而匿名登录（前端一行 signInAnonymously）只解决"能调云函数"，
//   鉴权仍由我们自己的 token 完成 —— 逻辑可控，面试也讲得清。
//
// 【返回约定】与其它路由型云函数一致：{ code, data, msg }
//   0 成功 / -1 参数错 / -2 尚未设置密码 / 401 未认证 / 403 无管理端权限 / -99 未知 action / -500 异常
// 【token 位置】业务云函数统一读 `event.adminToken`（**顶层**，见 adminGuard.js）；
//   本函数的 `me` / `changePassword` 两种都读（`params.token || event.adminToken`），
//   前端可以一律放顶层，不必为这一个函数记特例。
// ============================================================================
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const authService = require('./service')
const { signToken, verifyToken } = require('./adminToken')

const ok = (data, msg = 'success') => ({ code: 0, data, msg })
const fail = (code, msg) => ({ code, msg })

/** 统一的管理员信息 DTO（不下发密码哈希、_openid 等） */
function toAdminDTO(doc) {
  return {
    uid: authService.uidOf(doc),
    username: (doc.userInfo && doc.userInfo.username) || '',
    role: doc.role || '',
    isAdmin: true,
  }
}

exports.main = async (event) => {
  const { action, params } = event || {}
  const p = params || {}
  try {
    switch (action) {
      // ---------------------------------------------------------------- 登录
      case 'login': {
        const account = String(p.account || '').trim()
        const password = String(p.password || '')
        if (!account || !password) return fail(-1, '请输入账号与密码')

        const doc = await authService.findAdmin(account)
        // 不区分"账号不存在"与"密码错误"，减少账号枚举
        if (!doc) return fail(401, '账号或密码错误')
        if (!doc.isAdmin) return fail(403, '该账号没有管理端权限')

        const uid = authService.uidOf(doc)
        if (!uid) return fail(403, '该账号资料不完整（缺少学号/工号）')

        // 【为什么拿到 uid 后还要再按 uid 查一次】
        //   账号（姓名）可能匹配到多条记录，而改密是按 uid 定位的；
        //   校验密码必须落在**与改密同一条**记录上，否则就是"改了 A、登录读 B"。
        //   findAdmin 只负责"账号 → uid"，真正的"身份文档"一律以 findByUid 为准。
        const target = (await authService.findByUid(uid)) || doc
        if (!target.isAdmin) return fail(403, '该账号没有管理端权限')
        if (!target.adminPasswordHash) {
          return fail(-2, '该账号尚未设置管理端密码，请先设置密码')
        }
        if (!authService.verifyPassword(target, password)) return fail(401, '账号或密码错误')

        const v = Number(target.adminTokenVersion || 0)
        return ok({ token: signToken(uid, v), user: toAdminDTO(target) }, '登录成功')
      }

      // ------------------------------------------- 会话校验（前端刷新后调用）
      case 'me': {
        const payload = verifyToken(p.token || (event && event.adminToken))
        if (!payload) return fail(401, '登录已失效，请重新登录')
        const doc = await authService.findByUid(payload.uid)
        if (!doc || !doc.isAdmin) return fail(403, '该账号没有管理端权限')
        // 令牌版本不一致 = 已被强制下线（改密、或后台踢出）
        if (Number(doc.adminTokenVersion || 0) !== Number(payload.v || 0)) {
          return fail(401, '登录已失效，请重新登录')
        }
        return ok(toAdminDTO(doc))
      }

      // --------------------------------- 首次设置密码（仅当尚无密码时可用）
      case 'setPassword': {
        const account = String(p.account || '').trim()
        const password = String(p.password || '')
        if (password.length < 8) return fail(-1, '密码至少 8 位')
        const doc = await authService.findAdmin(account)
        if (!doc) return fail(401, '账号不存在')
        if (!doc.isAdmin) return fail(403, '该账号没有管理端权限')
        if (doc.adminPasswordHash) {
          return fail(-3, '该账号已设置过密码，请直接登录或使用「修改密码」')
        }
        const uid = authService.uidOf(doc)
        if (!uid) return fail(403, '该账号资料不完整（缺少学号/工号）')
        // 与 login 同一口径：写入目标一律取 findByUid 的那条，避免"设了 A、登录读 B"
        const target = (await authService.findByUid(uid)) || doc
        // 传 doc（含 _id）：按 _id 精确更新目标那一条，不靠 uid 反查
        const { v } = await authService.setPassword(target, password)
        return ok({ token: signToken(uid, v), user: toAdminDTO(target) }, '密码设置成功')
      }

      // ------------------------------------------------------------ 修改密码
      case 'changePassword': {
        const payload = verifyToken(p.token || (event && event.adminToken))
        if (!payload) return fail(401, '登录已失效，请重新登录')
        const oldPwd = String(p.oldPassword || '')
        const newPwd = String(p.newPassword || '')
        if (newPwd.length < 8) return fail(-1, '新密码至少 8 位')
        const doc = await authService.findByUid(payload.uid)
        if (!doc || !doc.isAdmin) return fail(403, '该账号没有管理端权限')
        if (!authService.verifyPassword(doc, oldPwd)) return fail(401, '原密码不正确')
        // 同上：用校验过原密码的这条 doc 的 _id 去写，避免 uid 重复时改错记录
        const { v } = await authService.setPassword(doc, newPwd)
        return ok(
          { token: signToken(payload.uid, v), user: toAdminDTO(doc) },
          '密码已更新，其它设备上的登录已失效',
        )
      }

      default:
        return fail(-99, '未知操作action')
    }
  } catch (err) {
    console.error('adminAuth error:', err)
    // msg 带上原因：管理端受众只有管理员，排查期"服务器异常"四个字等于没有信息
    // （例如密码写入校验失败必须让用户看见，否则又是一次"提示成功但实际没生效"）
    return { code: -500, msg: `服务器异常：${(err && err.message) || err}`, error: err && err.message }
  }
}
