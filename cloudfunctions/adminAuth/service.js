// cloudfunctions/adminAuth/service.js
// 管理端账号体系数据层：找管理员 / 设密码 / 校验密码
// ----------------------------------------------------------------------------
// 【为什么不新建 admin_account 集合】平台既有设计是「身份 role 与权限 isAdmin 分离」，
//   权限的唯一真相就是 user.isAdmin。再建一个集合会出现"两处真相"：
//   撤销权限时要同时改两边，容易不一致。所以直接把密码字段加在 user 文档上。
// 【密码怎么存】只存 bcryptjs 哈希（10 轮）。用 bcryptjs 而不是 bcrypt ——
//   bcrypt 是原生模块，云函数环境编译麻烦；bcryptjs 是纯 JS，直接可用。
// 【首次密码】adminPasswordHash 不存在时才允许设置（且必须 isAdmin === true），
//   避免"弱默认密码"这种经典事故；预置管理员（_openid 为空那条记录）也能安全启用。
// 【改密即强制下线】setPassword 同时把 adminTokenVersion +1 → 该管理员旧 token 全部失效。
// ============================================================================
const cloud = require('wx-server-sdk')
const bcrypt = require('bcryptjs')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/** bcrypt 轮数：10 ≈ 单次哈希 50~100ms，登录场景可接受 */
const BCRYPT_ROUNDS = 10

class AdminAuthService {
  constructor() {
    this.db = cloud.database()
    this.collection = this.db.collection('user')
  }

  /**
   * 按账号找管理员：纯数字 → 工号精确匹配；否则 → 姓名匹配（且必须是管理员）
   * @param {string} account
   */
  async findAdmin(account) {
    const acct = String(account || '').trim()
    if (!acct) return null
    if (/^\d+$/.test(acct)) {
      const res = await this.collection
        .where({ 'userInfo.uid': Number(acct) })
        .limit(1)
        .get()
      if (res.data && res.data[0]) return res.data[0]
    }
    const res2 = await this.collection
      .where({ 'userInfo.username': acct, isAdmin: true })
      .limit(1)
      .get()
    return (res2.data && res2.data[0]) || null
  }

  async findByUid(uid) {
    // limit(2) 而不是 1：多取一条只为**发现重复数据**。
    // 踩过的坑：user 集合里同一个 userInfo.uid 有两条记录时，
    // "改密改的是 A、登录读的是 B"，表现为"提示修改成功，但新密码登不上、旧密码还能登"。
    const res = await this.collection
      .where({ 'userInfo.uid': Number(uid) })
      .limit(2)
      .get()
    const list = res.data || []
    if (list.length > 1) {
      console.error(
        `[adminAuth] ⚠️ userInfo.uid=${uid} 存在 ${list.length} 条重复记录，_id=` +
          list.map((d) => d._id).join(','),
      )
    }
    return list[0] || null
  }

  /** 取管理员 uid（userInfo.uid），缺失返回 null */
  uidOf(doc) {
    const raw = doc && doc.userInfo ? doc.userInfo.uid : null
    return raw === undefined || raw === null ? null : Number(raw)
  }

  /** bcrypt 校验（同步：云函数单请求场景下，~100ms 阻塞可接受，且避免 bcryptjs 版本差异） */
  verifyPassword(doc, plainPassword) {
    if (!doc || !doc.adminPasswordHash) return false
    try {
      return bcrypt.compareSync(String(plainPassword), doc.adminPasswordHash)
    } catch (e) {
      console.error('[adminAuth] 密码校验异常', e)
      return false
    }
  }

  /**
   * 设置/修改密码（同时令牌版本 +1 → 强制下线）
   * @param {object} doc findByUid/findAdmin 取到的**完整文档**（必须有 _id）
   * @param {string} plainPassword 明文新密码
   * @returns {Promise<{v:number, _id:string, updated:number}>} 新的 adminTokenVersion 与写入诊断信息
   *
   * 【为什么按 _id 更新，而不是 where({'userInfo.uid': uid})】
   *   uid 重复时 where 更新的"第一条"未必是登录时读到的那条，
   *   会出现"提示修改成功、新密码却登不上、旧密码还能登"的假成功。
   *   按 _id 更新 = 改的就是刚刚校验过密码的那一条，目标唯一。
   *
   * 【为什么写完要回读校验】
   *   写入到底生效没有，只有读回来用 bcrypt 验一遍才知道。
   *   不校验就返回成功，等于把"写失败"伪装成"改密成功"，排查成本极高。
   */
  async setPassword(doc, plainPassword) {
    if (!doc || !doc._id) throw new Error('目标管理员文档不存在（缺少 _id），拒绝写入密码')
    const hash = bcrypt.hashSync(String(plainPassword), BCRYPT_ROUNDS)
    const nextV = Number(doc.adminTokenVersion || 0) + 1
    const res = await this.collection.doc(doc._id).update({
      data: {
        adminPasswordHash: hash,
        adminTokenVersion: nextV,
        adminPwdUpdatedAt: new Date(),
      },
    })
    const updated = (res && res.stats && res.stats.updated) || 0
    console.log(`[adminAuth] setPassword _id=${doc._id} updated=${updated} v=${nextV}`)

    // 回读校验：写没写进去、写进去的是不是新密码，必须当场确认
    const after = await this.collection.doc(doc._id).get()
    if (!after || !after.data || !this.verifyPassword(after.data, plainPassword)) {
      throw new Error('密码写入校验失败：回读后新密码校验不通过（写入未生效）')
    }
    return { v: nextV, _id: doc._id, updated }
  }
}

module.exports = new AdminAuthService()
