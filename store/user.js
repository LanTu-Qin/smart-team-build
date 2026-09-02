// store/user.js
const store = require('./index')
const user = {
  state: {
    userInfo: {
      uid: null,
      username: '',
      avatar: '/subPackages/images/user/user.jpg',
      institute: '', // 新增学院
      email: '',     // 新增邮箱（队友联系用）
      class: '',     // 新增班级
      skill_rating: {} // 技能等级映射 sid -> 1-5（AI 评级结果）
    },
    _openid: '',      // 新增微信标识
    tid_list: [],
    onGoing_cid: [],  // 【新增】正在参加的比赛（作为队长/队员），用于重复参赛拦截
    skills: [],
    isLogin: false,
    isAdmin: false,
    is_matching: false,
    role: 'student',
    profileComplete: false
  },
  getUserInfo(){
    return this.state
  },

  // 免费版云开发：cloud:// fileID 无法直接渲染，统一转成 https 临时链接
  // 非 cloud://（默认头像 / https 链接）原样返回；失败回退默认头像
  async resolveAvatarUrl(avatar) {
    if (!avatar || !avatar.startsWith('cloud://')) return avatar
    try {
      const res = await wx.cloud.callFunction({
        name: 'getFileUrl',
        data: { fileList: [avatar] }
      })
      const list = res.result && res.result.fileList
      if (list && list[0] && list[0].tempFileURL) {
        return list[0].tempFileURL
      }
    } catch (e) {
      console.warn('头像转链失败', e)
    }
    return '/subPackages/images/user/user.jpg'
  },

  login(userRaw) {
    // 从云端返回的用户对象中提取字段
    this.state.userInfo.uid = userRaw.userInfo.uid
    this.state.userInfo.username = userRaw.userInfo.username
    const rawAvatar = userRaw.userInfo.avatar
    this.state.userInfo.avatar = rawAvatar
    this.state.userInfo.institute = userRaw.userInfo.institute || ''
    this.state.userInfo.email = userRaw.userInfo.email || ''
    this.state.userInfo.class = userRaw.userInfo.class || ''
    this.state.userInfo.introduction = userRaw.userInfo.introduction || ''
    // skill_rating 存在 user 文档顶层（云函数 setSkillRatingMap 写入），需显式提取
    this.state.userInfo.skill_rating = userRaw.skill_rating || userRaw.userInfo.skill_rating || {}
    
    this.state._openid = userRaw._openid || ''
    this.state.role = userRaw.role || 'student'
    this.state.profileComplete = !!userRaw.profileComplete
    this.state.tid_list = userRaw.tid_list || []
    this.state.onGoing_cid = userRaw.onGoing_cid || []
    this.state.skills = userRaw.skills || []
    this.state.isAdmin = !!userRaw.isAdmin
    this.state.is_matching = !!userRaw.is_matching
    this.state.isLogin = true

    // 头像为 cloud:// fileID 时异步转链（loadUser 会 await 该任务）
    if (rawAvatar && rawAvatar.startsWith('cloud://')) {
      this._avatarTask = this.resolveAvatarUrl(rawAvatar).then(url => {
        this.state.userInfo.avatar = url
        this._avatarTask = null
      })
    } else {
      this._avatarTask = null
    }
  },

  logout() {
    this.state = {
      userInfo: { uid: null, username: '', avatar: '/subPackages/images/user/user.jpg', institute: '', email: '', class: '', skill_rating: {} },
      _openid: '', role: 'student', profileComplete: false,
      tid_list: [], onGoing_cid: [], skills: [], isLogin: false, isAdmin: false, is_matching: false
    }
  },
  // ========== 新增：首页统一初始化加载方法 loadUser() ==========
  /**
   * 从app.globalData 读取用户信息，初始化到store
   * 首页onShow统一调用，和loadCompetition/loadSkills同级
   */
  async loadUser() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: { action: 'wxLogin' }
      });
      if (res.result.code === 0) {
        const userData = res.result.data; // 含 _openid, userInfo, role, profileComplete...
        this.login(userData); // 调用现有 login 方法填充 store
        // 等待头像转链完成，保证拿到的是 https 临时链接
        if (this._avatarTask) await this._avatarTask
        return this.state;
      } else {
        // 登录失败或未授权，清空状态
        this.logout();
        return null;
      }
    } catch (err) {
      console.error('loadUser 失败', err);
      this.logout();
      return null;
    }
  },
  // 设置管理员权限
  setAdmin(isAdmin) {
    this.state.isAdmin = !!isAdmin
  },
  // 修改用户匹配状态
  setMatchStatus(isMatch) {
    this.state.is_matching = !!isMatch
  },

  async setTid(tid) {
    const uid = this.state.userInfo.uid
    if (!uid || uid === -1) {
      console.warn('用户未绑定uid，无法添加队伍')
      // 提前分支也要返回标准格式，不要return空
      return { code: -1, msg: '用户uid不存在' }
    }
    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: { action: 'addTid', params: { uid, tid } }
      })
      const cloudRes = res.result
      console.log("store-user-res:",res);
      console.log("res.result 原始值：",res.result, typeof res.result)
      console.log("res.result.code:", res.result?.code)
      if (cloudRes.code === 0) {
        // 加try-catch隔离loadUser，不要让用户信息刷新阻断主逻辑
        try{
          await this.loadUser()
        }catch(e){
          console.warn("刷新用户信息失败，不影响tid存储",e)
        }
        console.log('sb await this.loadUser()');
      } else {
        console.error('addTid 失败', res.result.msg)
      }
      return cloudRes
    } catch (err) {
      console.error('setTid 调用异常', err)
      // catch分支必须返回错误对象，杜绝undefined！
      return { code: -99, msg: '云函数调用异常', error: err }
    }
  },

  async removeTid(tid) {
    const uid = this.state.userInfo.uid
    if (!uid || uid === -1) return
    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: { action: 'removeTid', params: { uid, tid } }
      })
      if (res.result.code === 0) {
        await this.loadUser()
      } else {
        console.error('removeTid 失败', res.result.msg)
      }
    } catch (err) {
      console.error('removeTid 调用异常', err)
    }
  },

  async setTidList(tidArr) {
    const uid = this.state.userInfo.uid
    if (!uid || uid === -1) return
    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: { action: 'setTidList', params: { uid, tidList: tidArr } }
      })
      if (res.result.code === 0) {
        await this.loadUser()
      } else {
        console.error('setTidList 失败', res.result.msg)
      }
    } catch (err) {
      console.error('setTidList 调用异常', err)
    }
  },
  // 添加技能（自带去重逻辑）
  addSkill(skillId) {
    if (!this.state.skills.includes(skillId)) {
      this.state.skills.push(skillId)
    }
  },
  // 删除单个技能
  removeSkill(skillId) {
    this.state.skills = this.state.skills.filter(id => id !== skillId)
  },
  // 清空全部技能
  clearSkills() {
    this.state.skills = []
  },
  // 同步更新用户名/头像
  updateBaseInfo(info) {
    if (info.username) this.state.userInfo.username = info.username
    if (info.avatar) this.state.userInfo.avatar = info.avatar
  }
}
module.exports = user