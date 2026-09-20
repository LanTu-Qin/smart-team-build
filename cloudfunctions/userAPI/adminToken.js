// cloudfunctions/*/adminToken.js
// ============================================================================
// 管理端 token：HMAC-SHA256 自签（零第三方依赖）
// ----------------------------------------------------------------------------
// 【为什么自研而不引 jsonwebtoken】云函数装依赖会拖慢部署；而签名/验签/过期只需 node 内置
//   crypto 就够。而且自己实现才好讲清楚原理：payload 是明文（base64url，任何人都能解出来），
//   安全性完全由签名保证 —— 改了 payload 就验签失败。
//
// 【格式】base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, SECRET))
//   payload = { uid: 管理员工号, v: 令牌版本, exp: 过期时间戳(ms) }
//
// 【⚠️ 本文件在 5 个云函数里各有一份副本，内容必须完全一致】
//   adminAuth / competitionApi / userApi / teamsApi / skillApi
//   微信云开发没有跨云函数共享代码的"公共层"，只能各放一份。
//   改 token 格式或密钥逻辑时，5 处必须同步改（改完请在下面「变更记录」追加一行）。
//
// 变更记录：
//   2026-09-18 初版：payload {uid, v, exp}，TTL 7 天，timingSafeEqual 防时序攻击
// ============================================================================
const crypto = require('crypto')

/** 令牌有效期：7 天 */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function getSecret() {
  return process.env.ADMIN_TOKEN_SECRET || ''
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function b64urlDecode(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/**
 * 签发 token
 * @param {number} uid 管理员工号（对应 user.userInfo.uid）
 * @param {number} v   令牌版本（对应 user.adminTokenVersion，用于"强制下线"）
 * @returns {string}
 */
function signToken(uid, v) {
  if (!getSecret()) throw new Error('未配置 ADMIN_TOKEN_SECRET 环境变量')
  const payload = {
    uid: Number(uid),
    v: Number(v) || 0,
    exp: Date.now() + TOKEN_TTL_MS,
  }
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(crypto.createHmac('sha256', getSecret()).update(body).digest())
  return `${body}.${sig}`
}

/**
 * 验签 + 过期校验（只验 token 本身，不含 isAdmin 判断 —— 那属于云函数业务层）
 * @param {string} token
 * @returns {{uid:number, v:number, exp:number}|null} 合法返回 payload，否则 null
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !getSecret()) return null
  const parts = String(token).split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [body, sig] = parts

  const expect = b64url(crypto.createHmac('sha256', getSecret()).update(body).digest())
  // 时间恒定比较：避免通过响应时间差逐字节爆破签名
  const a = Buffer.from(sig)
  const b = Buffer.from(expect)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  let payload = null
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'))
  } catch (e) {
    return null
  }
  if (!payload || !payload.exp || Date.now() > Number(payload.exp)) return null
  if (!Number.isInteger(Number(payload.uid))) return null

  return { uid: Number(payload.uid), v: Number(payload.v) || 0, exp: Number(payload.exp) }
}

module.exports = { signToken, verifyToken, TOKEN_TTL_MS }
