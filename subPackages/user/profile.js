const store = require('../../store/index.js')
const defaultAvatar = '/subPackages/images/user/user.jpg'

Page({
  data: {
    defaultAvatar,
    avatarPreview: '',
    formData: {
      username: '',
      email: '',
      introduction: ''
    },
    allSkills: [],          // 完整技能列表 [{sid, name, desc}]
    selectedSkills: [],     // 已选 sid 数组
    selectedSkillMap: {},   // sid -> true，用于快速判断是否已选
    skillsMap: {},          // sid -> {name, desc}
    skill_rating: {},       // sid -> 等级(1-5)，来自 userInfo.skill_rating，用于图标染色
    // 技能等级 -> 图标颜色（白→蓝→紫→金→红，浅银灰替代纯白避免白底不可见）
    ratingColor: {
      0: '#C0C4CC',  // 未评级占位
      1: '#DCDFE6',  // 浅银灰
      2: '#4F8CFF',  // 蓝
      3: '#8B5CF6',  // 紫
      4: '#F59E0B',  // 暖金
      5: '#EF4444'   // 红
    },
    submitting: false,
    _avatarBase64: '',   // 新选头像的纯 base64（未选则为空），保存时传给云端上传
    // 用于显示技能描述（点击标签展开）
    showSkillDesc: false,
    currentDescSkill: null,
    // 表单是否被改动（与进入页面时的原始快照对比），用于启用/禁用保存按钮
    formChanged: false,
    // 原始数据快照（来自 store.user，便于检测改动）
    _snapshot: {
      username: '',
      email: '',
      introduction: '',
      selectedSkills: '',   // 排序后逗号分隔的字符串
      avatar: ''           // 头像 URL（用于判断是否换了头像）
    },
    // 等级 -> 颜色中文描述（与 ratingColor 保持一致，用于弹窗展示）
    _colorName: { 1: '银色', 2: '蓝色', 3: '紫色', 4: '金色', 5: '红色' }
  },

  onLoad() {
    this.loadUserData()
    this.loadSkills()
  },

  // 加载用户信息
  async loadUserData() {
    try {
      await store.user.loadUser()
      const userState = store.user.getUserInfo()
      const info = userState.userInfo || {}
      const username = info.username || ''
      const email = info.email || ''
      const introduction = info.introduction || ''
      const avatar = info.avatar || defaultAvatar
      const selectedSkills = userState.skills || []
      const skill_rating = info.skill_rating || {}
      this.setData({
        'formData.username': username,
        'formData.email': email,
        'formData.introduction': introduction,
        avatarPreview: avatar,
        selectedSkills,
        skill_rating,
        // 进入页面后还未改动
        formChanged: false,
        // 写入原始快照（后续用户编辑会和这份对比）
        _snapshot: {
          username,
          email,
          introduction,
          selectedSkills: selectedSkills.slice().sort().join(','),
          avatar
        },
        // 刷新时清空本次会话中新选的头像缓存，避免与持久数据混用
        _avatarBase64: ''
      })
      this.updateSelectedMap()
      this.updateSkillsMap()
    } catch (err) {
      console.error('加载用户信息失败', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 加载技能字典
  async loadSkills() {
    try {
      await store.skills.loadSkills()
      const allSkills = store.skills.getAll()  // 假设返回 [{sid, name, desc}]
      this.setData({ allSkills })
      this.updateSkillsMap()
    } catch (err) {
      console.error('加载技能失败', err)
    }
  },

  // 维护 selectedSkillMap（避免渲染时 indexOf，且规避类型不一致问题）
  updateSelectedMap() {
    const map = {}
    this.data.selectedSkills.forEach(sid => {
      map[Number(sid)] = true
      map[String(sid)] = true
    })
    this.setData({ selectedSkillMap: map })
  },

  // 更新技能映射
  updateSkillsMap() {
    const map = {}
    this.data.allSkills.forEach(s => {
      map[s.sid] = { name: s.name, desc: s.desc || '' }
    })
    this.setData({ skillsMap: map })
  },

  // 检测当前表单是否相对原始快照有改动，决定保存按钮是否可点
  checkFormChanged() {
    const s = this.data._snapshot
    const f = this.data.formData
    const changed =
      (f.username || '') !== (s.username || '') ||
      (f.email || '') !== (s.email || '') ||
      (f.introduction || '') !== (s.introduction || '') ||
      this.data.selectedSkills.slice().sort().join(',') !== (s.selectedSkills || '') ||
      !!this.data._avatarBase64
    if (this.data.formChanged !== changed) {
      this.setData({ formChanged: changed })
    }
  },

  // 把当前最新评级格式化为多行文本，供弹窗展示
  buildRatingMessage() {
    const rating = this.data.skill_rating || {}
    const skillsMap = this.data.skillsMap || {}
    const lines = []
    this.data.selectedSkills.forEach(sid => {
      const sidNum = Number(sid)
      const sk = skillsMap[sidNum] || skillsMap[sid]
      if (!sk) return
      const r = rating[sidNum] || rating[sid] || 1
      const colorName = this.data._colorName[r] || '银色'
      lines.push(`「${sk.name}」为 ${r} 级，${colorName}`)
    })
    return lines.join('\n')
  },

  // 选择头像
  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const tempFile = res.tempFiles[0]
        const filePath = tempFile.tempFilePath
        wx.getFileSystemManager().readFile({
          filePath: filePath,
          encoding: 'base64',
          success: (fileRes) => {
            const pureBase64 = fileRes.data
            // 预览需要 data: 前缀；云端上传只需要纯 base64
            this.setData({ avatarPreview: `data:image/jpeg;base64,${pureBase64}` })
            this.data._avatarBase64 = pureBase64
            this.checkFormChanged()
          },
          fail: (err) => {
            console.error('读取头像失败', err)
            wx.showToast({ title: '读取失败', icon: 'none' })
          }
        })
      }
    })
  },

  // 表单输入
  onInput(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    this.setData({
      [`formData.${key}`]: value
    })
    this.checkFormChanged()
  },

  // 技能 chip 点击切换
  toggleSkill(e) {
    const sid = Number(e.currentTarget.dataset.sid)
    const list = this.data.selectedSkills.slice()
    const idx = list.indexOf(sid)
    if (idx > -1) {
      list.splice(idx, 1)
    } else {
      list.push(sid)
    }
    this.setData({ selectedSkills: list })
    this.updateSelectedMap()
    this.checkFormChanged()
  },

  // 点击已选技能：弹出描述
  onSkillTagTap(e) {
    const sid = Number(e.currentTarget.dataset.sid)
    const skill = this.data.skillsMap[sid]
    if (!skill) return
    this.setData({
      showSkillDesc: true,
      // 保留 sid 用于弹窗图标按等级染色
      currentDescSkill: { sid, name: skill.name, desc: skill.desc || '' }
    })
  },

  // 关闭弹窗
  onPopupClose() {
    this.setData({ showSkillDesc: false })
  },

  // 提交表单
  async submitForm() {
    const username = this.data.formData.username.trim()
    if (!username) {
      wx.showToast({ title: '请填写昵称', icon: 'none' })
      return
    }
    // 邮箱必填且格式合法（队友联系用）
    const email = this.data.formData.email.trim()
    if (!email) {
      wx.showToast({ title: '请填写邮箱', icon: 'none' })
      return
    }
    if (!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(email)) {
      wx.showToast({ title: '邮箱格式不正确', icon: 'none' })
      return
    }

    this.setData({ submitting: true })

    try {
      const userState = store.user.getUserInfo()
      const uid = userState.userInfo.uid
      const introduction = this.data.formData.introduction.trim()
      const selectedSkills = this.data.selectedSkills

      // 平铺参数，对齐 userApi.updateProfile 云函数契约：
      // { role, uid, username, email, introduction, institute, avatarBase64 }
      const params = {
        role: userState.role || 'student',
        uid,
        username,
        email: this.data.formData.email.trim(),
        introduction,
        // 编辑页不提供学院输入，回填 store 中已有值，避免后端以空串覆盖（清空学院）
        institute: userState.userInfo.institute || '',
        // 只有新选了头像才上传（云端按 openid 存到 images/user/{openid}/avatar.jpg）
        avatarBase64: this.data._avatarBase64
      }

      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: {
          action: 'updateProfile',
          params
        }
      })

      if (res.result.code === 0) {
        // 保存技能列表（云端 setSkillList 会同步生成 skill_rating 并保留原等级）
        try {
          await wx.cloud.callFunction({
            name: 'userApi',
            data: {
              action: 'setSkillList',
              params: { uid, skillList: selectedSkills }
            }
          })
        } catch (e) {
          console.warn('技能保存失败', e)
        }

        // 更新 store 并在本页原地刷新（不再跳转 user 页）
        await store.user.loadUser()
        await this.loadUserData()
        this.setData({ submitting: false })
        wx.showToast({ title: '保存成功', icon: 'success' })

        // 未选择技能时无需 AI 评级，直接停留本页
        if (!selectedSkills || selectedSkills.length === 0) {
          return
        }

        // 触发 AI 评级（优先真实讯飞 MaaS，失败自动回退本地模拟），完成后弹窗提示。
        // 注：不展示"AI 评级中"的全屏转圈，保存后静默等待，评级完成后原地刷新并弹窗。
        const rated = await this.triggerAIRating(uid, selectedSkills, introduction)

        if (rated) {
          // 评级已入库，再次原地刷新以展示最新星级
          await store.user.loadUser()
          await this.loadUserData()
          // 保存成功后把"原始快照"更新为最新数据，便于按钮回到禁用状态
          const lines = this.buildRatingMessage()
          wx.showModal({
            title: 'AI 评级完成',
            content: `根据您的个人简介中对技能的描述，AI 已为您生成对应评级：\n${lines}`,
            showCancel: false,
            confirmText: '知道了'
          })
        }
      } else {
        this.setData({ submitting: false })
        wx.showToast({ title: res.result.msg || '保存失败', icon: 'none' })
      }
    } catch (err) {
      console.error('保存失败', err)
      this.setData({ submitting: false })
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  // ========== AI 评级 ==========
  // 优先调用真实 AI（userApi.aiRateSkills，讯飞 MaaS），失败时回退本地关键词模拟评级。
  // 返回 true 表示评级结果已入库（真实 AI 或本地模拟成功），false 表示未评级/入库失败。
  // 注意：userApi 云函数需已 `npm install axios` 并重新部署，否则会走本地模拟。
  async triggerAIRating(uid, skills, introduction) {
    if (!skills || skills.length === 0) {
      console.log('[AI Rating] 无技能，跳过评级')
      return false
    }

    console.log('[AI Rating] 触发评级:', { uid, skills, introduction })

    // 1) 尝试真实 AI 评级（aiRateSkills 内部已入库）
    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: {
          action: 'aiRateSkills',
          params: { uid, skills, introduction }
        }
      })
      console.log('res.result:',res.result);
      if (res.result && res.result.code === 0) {
        console.log('[AI Rating] AI 评级成功:', res.result.data)
        return true
      }
      console.warn('[AI Rating] AI 评级失败，回退本地模拟:', res.result && res.result.msg)
    } catch (err) {
      console.error('[AI Rating] AI 调用异常，回退本地模拟:', err)
    }

    // 2) 回退：本地关键词模拟评级 + setSkillRatingMap 入库
    const rating = this.localSimulateRating(skills, introduction)
    try {
      await wx.cloud.callFunction({
        name: 'userApi',
        data: {
          action: 'setSkillRatingMap',
          params: { uid, skill_rating: rating }
        }
      })
      console.log('[AI Rating] 本地模拟评级保存成功', rating)
      return true
    } catch (err) {
      console.error('[AI Rating] 本地模拟评级保存失败', err)
      return false
    }
  },

  // 本地关键词模拟评级（保底方案，不依赖云函数 AI 能力）
  localSimulateRating(skills, introduction) {
    // 构建技能映射（sid -> desc）
    const skillDescMap = {}
    this.data.allSkills.forEach(s => {
      skillDescMap[s.sid] = s.desc || ''
    })

    const rating = {}
    const keywords = introduction ? introduction.split(/[\s,，、.。；;]+/).filter(w => w.length > 1) : []

    skills.forEach(sid => {
      const desc = skillDescMap[sid] || ''
      // 计算匹配得分：简介中出现的技能描述关键词越多，分数越高
      let score = 1 // 默认1星
      if (desc && keywords.length > 0) {
        // 提取描述中的关键词（忽略停用词，此处简单分词）
        const descWords = desc.split(/[\s,，、.。；;（）()]+/).filter(w => w.length > 1)
        let matchCount = 0
        descWords.forEach(word => {
          if (keywords.some(k => k.includes(word) || word.includes(k))) {
            matchCount++
          }
        })
        // 匹配度：0个匹配=1星，1-2个=2星，3-4个=3星，5-6个=4星，>=7个=5星
        if (matchCount >= 7) score = 5
        else if (matchCount >= 5) score = 4
        else if (matchCount >= 3) score = 3
        else if (matchCount >= 1) score = 2
        else score = 1
      }
      rating[sid] = score
    })
    return rating
  }
})