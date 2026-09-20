const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
// 云存储默认头像（与数据库中存量用户保持一致，新用户也写入该 fileID）
const DEFAULT_AVATAR = 'cloud://cloud1-d8gb9nir3847ec081.636c-cloud1-d8gb9nir3847ec081-1444113575/images/user/user.jpg'
class UserService {
  constructor() {
    this.collection = db.collection('user')
  }

  // 工具方法：根据技能数组生成同步后的skill_rating
  _genSkillRating(skillArr, oldRating = {}) {
    const newRating = {}
    skillArr.forEach(sid => {
      // 已有等级保留，不存在默认1
      newRating[sid] = oldRating[sid] ?? 1
    })
    return newRating
  }

  // 1. 根据 _openid 查询用户（根层字段）
  async getByOpenId(_openid) {
    const res = await this.collection.where({ _openid }).get()
    return res.data[0] || null
  }

  // 存量数据修复：老用户 avatar 仍是本地路径 → 统一修正为云存储默认头像
  async fixLegacyDefaultAvatar(user) {
    const legacyPath = '/subPackages/images/user/user.jpg'
    if (user && user.userInfo && user.userInfo.avatar === legacyPath) {
      await this.collection.doc(user._id).update({
        data: { 'userInfo.avatar': DEFAULT_AVATAR }
      })
      user.userInfo.avatar = DEFAULT_AVATAR
    }
    return user
  }

  // 2. 创建全新的微信临时用户（uid设为-1，等待绑定）
  async createWechatUser(_openid) {
    const userData = {
      _openid,
      userInfo: {
        uid: -1,
        username: '微信用户',
        avatar: DEFAULT_AVATAR,
        institute: '',
        email: '',
        introduction:''
      },
      role: 'student',
      profileComplete: false,
      tid_list: [],
      skills: [],
      skill_rating: {}, // 初始化空技能等级对象
      isAdmin: false,
      is_matching: false
    }
    await this.collection.add({ data: userData })
    return userData
  }

  /**
 * 绑定管理员账号（仅当 uid 匹配且为未绑定的 admin 记录）
 */
  async bindAdminByUid(uid, _openid, profile) {
    // 1. 查询是否存在 role=admin, userInfo.uid=uid, profileComplete=false 的记录
    const res = await this.collection.where({
      'userInfo.uid': Number(uid),
      role: 'admin',
      profileComplete: false
    }).get()
    if (res.data.length === 0) {
      throw new Error('该管理员账号不存在或已被绑定')
    }
    const adminRecord = res.data[0]
    // 2. 防止被其他微信用户恶意绑定（已有 _openid 且与当前不一致）
    if (adminRecord._openid && adminRecord._openid !== _openid) {
      throw new Error('该管理员账号已被其他用户绑定')
    }
    // 3. 更新该记录
    const updateData = {
      _openid: _openid,
      'userInfo.uid': Number(profile.uid),
      'userInfo.username': profile.username,
      'userInfo.email': profile.email,
      'userInfo.institute': profile.institute || '',
      role: 'admin',
      profileComplete: true
    }
    if (profile.avatar) {
      updateData['userInfo.avatar'] = profile.avatar
    }
    await this.collection.where({ _id: adminRecord._id }).update({ data: updateData })
    await this.collection.where({
      _openid,
      "userInfo.uid": -1
    }).remove()
    // 返回最新数据
    const updated = await this.collection.doc(adminRecord._id).get()
    return updated.data
  }

  /**
   * 上传用户头像到云存储：images/user/{openid}/avatar.jpg
   * 每个用户独立目录，同名覆盖（始终是同一个 fileID）
   */
  async uploadAvatar(openid, imageBase64) {
    const buffer = Buffer.from(imageBase64, 'base64')
    const cloudPath = `images/user/${openid}/avatar.jpg`
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: buffer
    })
    return uploadRes.fileID // 形如 cloud://env-id/images/user/xxx/avatar.jpg
  }

  /**
   * 完善个人信息（根据角色区分处理）
   * 参数对齐前端：平铺的 { role, uid, username, email, introduction, institute, avatarBase64 }
   *  - avatarBase64: 新头像的纯 base64（不带 data:image 前缀），为空则不更新头像
   *  - avatar:       旧链路兼容（直接传 fileID/链接）
   */
  async updateProfile(_openid, profile) {
    const role = profile.role || 'student'
    // 【新增】uid（学号/工号）唯一性校验：该 uid 已被其他账号占用则拒绝绑定
    //  - 同一 _openid 重复提交（改资料）放行
    //  - 临时用户 uid=-1 不参与校验
    //  - 预置管理员工号（_openid 为空）也视为已占用，防止学生抢占
    const newUid = Number(profile.uid)
    if (newUid > 0) {
      const uidOccupied = await this.collection.where({
        'userInfo.uid': newUid,
        _openid: _.neq(_openid)
      }).get()
      if (uidOccupied.data.length > 0) {
        throw new Error('该学号/工号已被其他账号绑定')
      }
    }
    // 先查该 _openid 是否已有完整用户记录（学生已完善 / 管理员已绑定）
    const existing = await this.collection.where({ _openid }).get()
    const alreadyBoundAdmin = role === 'admin' &&
      existing.data.length > 0 && existing.data[0].profileComplete === true

    // 仅当「管理员且尚未绑定」时才走专用绑定流程
    // 已绑定管理员直接走下方通用更新，避免 bindAdminByUid 查不到未绑定记录而 throw
    if (role === 'admin' && !alreadyBoundAdmin) {
      console.log("管理员：", profile);
      return await this.bindAdminByUid(profile.uid, _openid, profile)
    }
    // 学生/教师/已绑定管理员：基于 _openid 更新临时用户（或创建新用户）
    const updateData = {
      'userInfo.uid': Number(profile.uid),
      'userInfo.username': profile.username,
      'userInfo.email': profile.email,
      'userInfo.institute': profile.institute || '',
      'userInfo.introduction': profile.introduction || '',
      role: role,
      profileComplete: true
    }
    // 头像：优先 base64（新链路，云端上传到用户独立目录）
    if (profile.avatarBase64 && profile.avatarBase64.trim() !== '') {
      updateData['userInfo.avatar'] = await this.uploadAvatar(_openid, profile.avatarBase64)
    } else if (profile.avatar) {
      // 兼容旧链路：直接存传入的 fileID / 链接
      updateData['userInfo.avatar'] = profile.avatar
    }
    // 【onGoing_cid】作为最后修改的字段：仅当此前是未绑定临时用户（uid === -1）时重置为空数组，
    // 清除 uid=-1 阶段可能残留的参赛记录（teamsApi 对临时用户无拦截，可能被写入脏 cid），
    // 避免绑定学号后发布队伍被误拦截；已绑定用户改资料不重置，保留真实参赛记录
    const prevUser = existing.data[0]
    const prevUid = prevUser && prevUser.userInfo ? prevUser.userInfo.uid : null
    if (prevUid === -1) {
      updateData['onGoing_cid'] = []
    }
    if (existing.data.length === 0) {
      // 安全兜底：若没有则创建新用户（正常情况 wxLogin 已创建）
      const newUser = {
        _openid,
        userInfo: {
          uid: Number(profile.uid),
          username: profile.username,
          avatar: profile.avatar || DEFAULT_AVATAR,
          institute: profile.institute || '',
          introduction: profile.introduction || ''
        },
        role: role,
        profileComplete: true,
        tid_list: [],
        skills: [],
        skill_rating: {},
        isAdmin: false,
        is_matching: false,
        onGoing_cid: [] // 最后初始化：正在参加的比赛（作为队长/队员），用于重复参赛拦截
      }
      const addRes = await this.collection.add({ data: newUser })
      const getRes = await this.collection.doc(addRes._id).get()
      return getRes.data
    } else {
      await this.collection.where({ _openid }).update({ data: updateData })
      const res = await this.collection.where({ _openid }).get()
      return res.data[0] || null
    }
  }

  // 更新用户名、头像基础信息（旧版接口，index.js 有对应 case，补齐实现避免 TypeError）
  async updateBase(uid, info) {
    if (!uid) throw new Error('缺少 uid')
    if (!info || typeof info !== 'object') throw new Error('info 参数格式错误')
    const updateData = {}
    if (info.username) updateData['userInfo.username'] = info.username
    if (info.avatar) updateData['userInfo.avatar'] = info.avatar
    if (Object.keys(updateData).length === 0) return true
    await this.collection.where({ "userInfo.uid": Number(uid) }).update({
      data: updateData
    })
    return true
  }

  // 5. 按 uid 查用户（详情）
  // 【契约第 10 条】Web 管理端详情需要「扁平 DTO + email」，而 C 端（subPackages/team/team_info.js）
  //   依赖原来的嵌套 userInfo 结构 —— 因此**不直接改返回结构**，改为由调用方用 flat 参数显式选择：
  //     flat: true   → 扁平 DTO + email（管理端）
  //     不传 / false → 原始文档（C 端，完全向后兼容）
  async getByUid(uid, options = {}) {
    // 库里 userInfo.uid 是 number，统一 Number 归一，避免网关传字符串 "20260001" 查不到
    const uidNum = Number(uid)
    const res = await this.collection
      .where({ 'userInfo.uid': Number.isNaN(uidNum) ? uid : uidNum })
      .get()
    const doc = res.data[0] || null
    if (doc && options.flat) return this._toUserDTO(doc, { withEmail: true })
    return doc
  }
  async getBatchUids(uidList) {
    const res = await this.collection.where({ "userInfo.uid": _.in(uidList) }).get()
    // 隐私：批量查询不下发 email，邮箱仅通过 getContact（同队校验）获取
    return res.data.map(item => {
      const copy = Object.assign({}, item)
      if (copy.userInfo) {
        copy.userInfo = Object.assign({}, copy.userInfo)
        delete copy.userInfo.email
      }
      return copy
    })
  }

  /**
   * 【新增】查询全部指导老师候选（role=teacher 的用户）
   * 用于队伍详情页"添加指导老师"弹窗；不下发 email（隐私）
   * @returns {Array<{uid, username, avatar, institute}>}
   */
  async getTeachers() {
    const res = await this.collection.where({ role: 'teacher' }).get()
    return res.data
      .filter(u => u.userInfo && Number(u.userInfo.uid) > 0)
      .map(u => ({
        uid: Number(u.userInfo.uid),
        username: u.userInfo.username || '未知用户',
        avatar: u.userInfo.avatar || '',
        institute: u.userInfo.institute || ''
      }))
  }

  // 获取队友联系方式（简化版：同队成员点"获取邮箱"直接展示+复制）
  // 安全边界：仅当请求者(_openid)与目标用户在同一队伍时才返回邮箱；手机号永不下发
  // scope='match'：匹配推荐场景，候选用户来自匹配池（双向意向），请求方是本队成员即可
  async getContact(_openid, tid, targetUid, scope) {
    const me = await this.getByOpenId(_openid)
    if (!me) throw new Error('用户不存在')
    const myUid = Number(me.userInfo.uid)
    if (myUid === -1) throw new Error('请先完成身份绑定')

    const teamRes = await db.collection('teams').where({ tid: Number(tid) }).get()
    const team = teamRes.data[0]
    if (!team) throw new Error('队伍不存在')

    // 收集队伍全部成员 uid：队长 + 指导老师（advisor 数组 + 兼容旧 teacher_uid）+ members 键
    const memberUids = new Set()
    if (team.leader) memberUids.add(Number(team.leader))
    ;(team.advisor || []).forEach(uid => memberUids.add(Number(uid)))
    if (team.teacher_uid) memberUids.add(Number(team.teacher_uid))
    Object.keys(team.members || {}).forEach(str => memberUids.add(Number(str)))

    const targetNum = Number(targetUid)
    if (!memberUids.has(myUid)) throw new Error('仅队伍成员可查看联系方式')
    // 匹配场景：候选用户来自匹配池（双向意向），目标不必是本队成员；
    // 队伍详情场景（默认）：目标必须是同队成员
    if (scope !== 'match' && !memberUids.has(targetNum)) throw new Error('对方不是该队伍成员')

    const target = await this.getByUid(targetNum)
    if (!target) throw new Error('目标用户不存在')
    return {
      uid: targetNum,
      email: (target.userInfo && target.userInfo.email) || ''
    }
  }

  // 批量覆盖设置用户技能列表（核心：同步更新skill_rating）
  // 浅合并写入新评级，同时用 _.remove() 删除已移除技能的旧 sid 字段，
  // 避免 update 对象浅合并导致旧 sid 残留在 skill_rating 中
  async setSkillList(uid, skillList) {
    const safeSkills = Array.isArray(skillList) ? skillList : []
    const uidNum = Number(uid)
    const user = await this.getByUid(uidNum)
    if (!user) throw new Error('用户不存在')
    const oldRating = user.skill_rating || {}
    const newRating = this._genSkillRating(safeSkills, oldRating)

    // 浅合并：写入新 skills + 新评级，并删除不再使用的旧 sid 字段
    const updateData = {
      skills: safeSkills,
      skill_rating: newRating
    }
    Object.keys(oldRating).forEach(sid => {
      if (!newRating.hasOwnProperty(sid)) {
        updateData[`skill_rating.${sid}`] = _.remove()
      }
    })

    await this.collection.where({ 'userInfo.uid': uidNum }).update({
      data: updateData
    })
  }

  // 单独修改某个技能的等级（提供接口给前端调整等级）
  async updateSkillRating(uid, sid, level) {
    const uidNum = Number(uid)
    const user = await this.getByUid(uidNum)
    if (!user) throw new Error('用户不存在')
    const skills = user.skills || []
    if (!skills.includes(sid)) throw new Error('用户未拥有该技能，无法修改等级')

    await this.collection.where({ 'userInfo.uid': uidNum }).update({
      data: {
        [`skill_rating.${sid}`]: Number(level)
      }
    })
  }

  // 批量覆盖技能等级（保存前端/AI 评级结果，整表覆盖）
  // 浅合并写入新评级，同时删除旧评级中不在本次范围内的 sid 字段（防残留）
  async setSkillRatingMap(uid, ratingMap) {
    const uidNum = Number(uid)
    if (!ratingMap || typeof ratingMap !== 'object' || Array.isArray(ratingMap)) {
      throw new Error('评级数据格式错误')
    }
    const user = await this.getByUid(uidNum)
    if (!user) throw new Error('用户不存在')

    // 规范化：只保留 1~5 的合法星级
    const safeRating = {}
    Object.keys(ratingMap).forEach(sid => {
      const level = Number(ratingMap[sid])
      if (!Number.isNaN(level)) {
        safeRating[sid] = Math.min(5, Math.max(1, Math.round(level)))
      }
    })

    // 浅合并 + 删除残留旧 sid
    const updateData = { skill_rating: safeRating }
    Object.keys(user.skill_rating || {}).forEach(sid => {
      if (!safeRating.hasOwnProperty(sid)) {
        updateData[`skill_rating.${sid}`] = _.remove()
      }
    })

    await this.collection.where({ 'userInfo.uid': uidNum }).update({
      data: updateData
    })
    return safeRating
  }

  // ==================== AI 技能评级（已对齐 competitionApi 接入方式） ====================
  // 说明：复刻 competitionApi 的讯飞 MaaS 接入方式，与竞赛 AI 生成共用同一个 API Key。
  // 使用前提：
  //   1. 在 cloudfunctions/userApi 目录执行 `npm install axios`（package.json 已声明依赖）
  //   2. 在微信开发者工具中重新上传部署 userApi 云函数
  // 前端 triggerAIRating 已切换到本方法；若 AI 调用失败会回退本地关键词模拟评级。
  async aiRateSkills(uid, skills, introduction) {
    // 注意：axios 为动态 require，未安装依赖时不影响其他 action 的正常使用
    const axios = require('axios')

    const skillList = Array.isArray(skills) ? skills.map(Number) : []
    if (skillList.length === 0) return {}

    // 1. 取出技能字典（复用 skills 集合）
    const skillRes = await db.collection('skills').get()
    const skillDict = skillRes.data || []
    const descMap = {}
    skillDict.forEach(s => { descMap[Number(s.sid)] = s.desc || s.name || '' })

    const descText = skillList
      .map(sid => `- 技能${sid}（${descMap[sid] || '未知'}）：${descMap[sid] || '暂无描述'}`)
      .join('\n')

    // 2. 构造提示词
    const prompt = [
      '你是大学生竞赛团队平台的技能评估专家。',
      '根据用户个人简介，为以下每项技能给出 1~5 星的熟练度评级（整数）。',
      '只输出 JSON 对象，格式如 {"1":4,"2":2}，key 为技能 sid，value 为星级，不要输出其他内容。',
      '',
      '用户个人简介：',
      (introduction || '（未填写）'),
      '',
      '待评级技能：',
      descText
    ].join('\n')

    // 3. 调用讯飞 MaaS（请求体与 competitionApi 完全对齐）
    // 密钥已改为从云开发控制台环境变量读取（AI_API_KEY），未配置时请求会 401
    const AI_URL = 'https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions'
    const AI_API_KEY = process.env.AI_API_KEY || ''
    const AI_MODEL_ID = process.env.AI_MODEL_ID || 'xopdeepseekv32'
    const LORA_ID = '0'

    let resp
    try {
      resp = await axios.post(AI_URL, {
        model: AI_MODEL_ID,
        messages: [
          { role: 'system', content: '你是一个严格的技能评估助手，只输出 JSON。' },
          { role: 'user', content: prompt }
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 1024,
        extra_headers: { // 关键：lora_id 必须放在 extra_headers，放顶层会报错
          lora_id: LORA_ID
        },
        stream_options: {
          include_usage: true
        }
      }, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_API_KEY}`
        },
        timeout: 25000
      }).catch(err => {
        if (err.code === 'ECONNABORTED') {
          throw new Error('大模型接口请求超时，请重试')
        }
        throw err
      })
    } catch (err) {
      console.error('[aiRateSkills] AI 调用失败:', err.response?.status, err.response?.data || err.message)
      if (err.response?.status === 401) throw new Error('APIKey错误或权限不足')
      if (err.response?.status === 404) throw new Error('接口地址/模型ID错误')
      if (err.code === 'ECONNABORTED') throw new Error('AI 接口请求超时')
      throw new Error(`模型调用异常：${err.message}`)
    }

    const content = resp.data && resp.data.choices && resp.data.choices[0]
      ? resp.data.choices[0].message.content
      : ''

    // 4. 解析并规范化 JSON
    let rating = {}
    try {
      const jsonText = content.replace(/```json|```/g, '').trim()
      rating = JSON.parse(jsonText)
    } catch (e) {
      console.error('[aiRateSkills] AI 返回解析失败:', content)
      throw new Error('AI 评级结果解析失败')
    }

    // 5. 只保留本次请求技能对应的合法星级
    const safeRating = {}
    skillList.forEach(sid => {
      const level = Number(rating[sid])
      if (!Number.isNaN(level)) {
        safeRating[sid] = Math.min(5, Math.max(1, Math.round(level)))
      }
    })
    if (Object.keys(safeRating).length === 0) {
      throw new Error('AI 评级结果无效')
    }

    // 6. 写入数据库（浅合并 + 删除残留旧 sid）
    const user = await this.getByUid(Number(uid))
    const updateData = { skill_rating: safeRating }
    Object.keys(user?.skill_rating || {}).forEach(sid => {
      if (!safeRating.hasOwnProperty(sid)) {
        updateData[`skill_rating.${sid}`] = _.remove()
      }
    })
    await this.collection.where({ 'userInfo.uid': Number(uid) }).update({
      data: updateData
    })
    return safeRating
  }

  // 修改tid_list
  async addTid(uid, tid) {
    await this.collection.where({ 'userInfo.uid': Number(uid) }).update({
      data: { tid_list: _.addToSet(tid) }
    })
  }
  async removeTid(uid, tid) {
    await this.collection.where({ 'userInfo.uid': Number(uid) }).update({
      data: { tid_list: _.pull(tid) }
    })
  }
  async setTidList(uid, tidList) {
    await this.collection.where({ 'userInfo.uid': Number(uid) }).update({
      data: { tid_list: Array.isArray(tidList) ? tidList : [] }
    })
  }

  // 设置/取消管理员权限（授予老师等角色 isAdmin，不改变其 role 身份）
  async setAdmin(uid, isAdmin) {
    const uidNum = Number(uid)
    if (!uidNum || uidNum <= 0) throw new Error('无效的用户uid')
    const user = await this.getByUid(uidNum)
    if (!user) throw new Error('用户不存在')
    const isAdminBool = !!isAdmin
    await this.collection.where({ 'userInfo.uid': uidNum }).update({
      data: { isAdmin: isAdminBool }
    })
    return { uid: uidNum, isAdmin: isAdminBool }
  }

  // 搜索用户：keyword 支持 uid 精确匹配或用户名模糊匹配，供管理员授权页使用
  async searchUsers(keyword) {
    const kw = String(keyword || '').trim()
    if (!kw) return []
    const uidNum = Number(kw)
    const tasks = []
    // 1) uid 精确匹配（keyword 为纯数字时）
    if (!Number.isNaN(uidNum)) {
      tasks.push(this.collection.where({ 'userInfo.uid': uidNum }).limit(20).get())
    }
    // 2) 用户名模糊匹配（正则，含 uid 字符串匹配兜底）
    try {
      tasks.push(this.collection
        .where({ 'userInfo.username': db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' }) })
        .limit(20).get())
    } catch (e) { /* 正则构造失败忽略 */ }

    let results = []
    if (tasks.length === 0) return []
    const settled = await Promise.all(tasks.map(p => p.catch(() => null)))
    settled.forEach(r => { if (r && r.data) results = results.concat(r.data) })

    // 按 uid 去重
    const seen = new Set()
    const merged = []
    results.forEach(item => {
      const u = item.userInfo ? item.userInfo.uid : item._id
      const key = String(u)
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(item)
      }
    })
    // 隐私保护：批量查询不下发 email
    return merged.slice(0, 20).map(item => {
      const copy = Object.assign({}, item)
      if (copy.userInfo) {
        copy.userInfo = Object.assign({}, copy.userInfo)
        delete copy.userInfo.email
      }
      return copy
    })
  }

  /**
   * 用户原始文档 → 契约 DTO（扁平化 + 脱敏，对齐 Web 管理端 GET /users）
   * ----------------------------------------------------------------------------
   * 【为何必须拍平】数据库是「混装结构」：
   *   - userInfo 内：uid / username / avatar / institute / email / class / introduction
   *   - 顶层      ：role / isAdmin / skills / skill_rating / tid_list / is_matching
   * 原 getPage 直接下发嵌套 userInfo，Web 端 row.username 取不到值（契约第 10 条）。
   * 另：老数据的 skill_rating / tid_list / is_matching 可能藏在 userInfo 内
   * （store/user.js 就是 `userRaw.skill_rating || userRaw.userInfo.skill_rating` 双兜底），
   * 故这里同样取值双兜底，兼容新旧数据。
   * 【脱敏】默认不下发 email（列表脱敏）、_openid（身份标识）、_id（内部主键）；
   *   详情接口可传 { withEmail: true } 显式带上 email（契约：邮箱只在详情下发）。
   */
  _toUserDTO(doc, { withEmail = false } = {}) {
    if (!doc) return null
    const info = doc.userInfo || {}
    // 取第一个「非 null / 非 undefined」的值（0 / '' / false 视为有效值）
    const pick = (...vals) => {
      for (const v of vals) {
        if (v !== undefined && v !== null) return v
      }
      return undefined
    }
    return {
      uid: pick(info.uid, doc.uid) ?? null,
      username: pick(info.username, doc.username) || '',
      avatar: pick(info.avatar, doc.avatar) || '',
      institute: pick(info.institute, doc.institute) || '',
      class: pick(info.class, doc.class) || '',
      introduction: pick(info.introduction, doc.introduction) || '',
      role: doc.role || '',
      isAdmin: !!doc.isAdmin,
      skills: pick(doc.skills, info.skills) || [],
      skill_rating: pick(doc.skill_rating, info.skill_rating) || {},
      tid_list: pick(doc.tid_list, info.tid_list) || [],
      is_matching: !!pick(doc.is_matching, info.is_matching),
      // 邮箱只在**详情**接口下发（列表一律脱敏）：由 withEmail 显式开启
      ...(withEmail ? { email: pick(info.email, doc.email) || '' } : {})
    }
  }

  /**
   * 分页查询用户（管理端列表），对齐 Web 管理端契约 GET /users
   * - keyword 纯数字 → userInfo.uid 精确匹配；否则 → 用户名模糊（不区分大小写）
   * - role 精确筛选（student/teacher/admin）
   * - 返回 { list, total, page, pageSize }；列表为扁平 DTO，不含 email / _openid / _id
   */
  async getPage(params = {}) {
    const page = Math.max(1, parseInt(params.page, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize, 10) || 20))
    const kw = String(params.keyword || '').trim()
    const role = String(params.role || '').trim()

    const where = {}
    if (kw) {
      if (/^\d+$/.test(kw)) {
        where['userInfo.uid'] = Number(kw)
      } else {
        where['userInfo.username'] = db.RegExp({
          regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          options: 'i'
        })
      }
    }
    if (role) where.role = role

    const countRes = await this.collection.where(where).count()
    const res = await this.collection.where(where)
      .orderBy('userInfo.uid', 'asc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    // 契约第 10 条：拍平成扁平 DTO（Web 端可直接 row.username 取用），
    // 同时剔除 _openid / _id（身份标识与内部主键）与 email（列表脱敏）
    const list = (res.data || []).map(doc => this._toUserDTO(doc))
    return { list, total: countRes.total, page, pageSize }
  }
}
module.exports = new UserService()
