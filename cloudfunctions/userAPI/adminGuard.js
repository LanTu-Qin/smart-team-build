// cloudfunctions/*/adminGuard.js
// ============================================================================
// 云函数鉴权：ensureAdmin(event) —— 「双通道」
// ----------------------------------------------------------------------------
// 解决的问题：Web 管理端没有微信 OPENID，而原来的 ensureAdmin 只认 OPENID
//   → 管理端所有写操作恒返回 -403「无管理员权限」。
//
//   ① 小程序端：有 OPENID → 按 _openid 查 user.isAdmin（**原逻辑，完全不变**）
//   ② Web 管理端：无 OPENID → 验签 event.adminToken（HMAC 自签 token）
//        → 取 uid → **重读 isAdmin** → 再校验 adminTokenVersion
//
// 【为什么不信任前端传的 uid】拿到匿名登录态后，任何人都能构造任意 event。
//   身份只能来自：OPENID（小程序）或**我们签过名的 token**（Web）——绝不接受裸 uid。
//
// 【为什么每次都重读 isAdmin】权限撤销必须"当场生效"，不能依赖 token 里的旧值。
// 【为什么校验令牌版本 v】改密 / 强制下线时 user.adminTokenVersion +1
//   → 该管理员所有旧 token 的 v 与之不等 → 立即全部失效。
//
// 【⚠️ 本文件在 4 个云函数里各有一份副本，内容必须完全一致】
//   competitionApi / userApi / teamsApi / skillApi
//   （adminAuth 只负责签发 token，不需要本文件）
//   微信云开发没有跨云函数共享代码的"公共层"，只能各放一份；改鉴权逻辑要同步改 4 处。
//
// 变更记录：
//   2026-09-18 初版：双通道（OPENID / adminToken）+ 重读 isAdmin + 令牌版本校验
// ============================================================================
const cloud = require('wx-server-sdk')
const { verifyToken } = require('./adminToken')

/**
 * @param {object} event 云函数入参（Web 管理端把 adminToken 放在这里）
 * @returns {Promise<boolean>} 调用者是否为管理员
 */
async function ensureAdmin(event) {
  const db = cloud.database()

  // ---------------- ① 小程序端：OPENID 通道（原逻辑） ----------------
  const { OPENID } = cloud.getWXContext()
  if (OPENID) {
    try {
      const res = await db.collection('user').where({ _openid: OPENID }).get()
      return !!(res.data[0] && res.data[0].isAdmin)
    } catch (e) {
      console.error('[ensureAdmin] OPENID 通道异常', e)
      return false
    }
  }

  // ---------------- ② Web 管理端：adminToken 通道 ----------------
  const payload = verifyToken(event && event.adminToken)
  if (!payload) return false
  try {
    const res = await db
      .collection('user')
      .where({ 'userInfo.uid': Number(payload.uid) })
      .get()
    const u = res.data[0]
    if (!u || !u.isAdmin) return false
    // 令牌版本不一致 = 已被强制下线（改密 / 后台踢出）
    if (Number(u.adminTokenVersion || 0) !== Number(payload.v || 0)) return false
    return true
  } catch (e) {
    console.error('[ensureAdmin] adminToken 通道异常', e)
    return false
  }
}

module.exports = { ensureAdmin }
