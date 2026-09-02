// pages/personal/personal.js

const store = require('../../store/index')

Page({
  data: {
    isLogin: false,
    userInfo: {
      name: ""
    },
    skillList: [],
    // 全局技能库从store.skills读取，不再写死静态数组
    originSkillList: [],
    searchMatchList: [],
    teamList: [],
    myMatchList: [],  // 【新增】个人匹配池（用户进入匹配池的赛事+技能）
    showSkillPopup: false,
    currentSkillInput: '',
    tempSkillList: []
  },

  async onShow() {
    // 关键：先同步globalData到store用户状态
    await store.user.loadUser()
  
    const userState = store.user.getUserInfo()
    const allTeams = store.teams.getList()
    const allComp = store.competition.getList()
    const allSkillData = store.skills.getAll()
    const defaultAvatar = '/subPackages/images/user/user.jpg'
  
    // 全局全部技能名称（下拉联想用）
    const originSkillList = allSkillData.map(item => ({
      sid: item.sid,
      name: item.name,
      desc: item.desc || ''
    }))
  
    if (!userState.isLogin) {
      this.setData({
        isLogin: false,
        userInfo: { name: '', intro: '' },
        userAvatar: defaultAvatar,
        skillList: [],
        skillTagList: [],
        originSkillList,
        teamList: []
      })
      return
    }
  
    // 1. 用户基础信息
    const userName = userState.userInfo.username || '未设置昵称'
    const userAvatar = userState.userInfo.avatar || defaultAvatar
    const userIntro = userState.userInfo.introduction || ''
    const userSidArr = userState.skills || [] // 用户sid数组 [2,5,6,7]

    // ========== 核心：sid 转 技能名称数组 ==========
    const userSkillNames = userSidArr.map(sid => {
      const target = allSkillData.find(skill => skill.sid === sid)
      return target ? target.name : '未知技能'
    })
    // 技能标签带等级（用于按 AI 评级染色）
    const userRating = userState.userInfo.skill_rating || {}
    const skillTagList = userSidArr.map(sid => {
      const target = allSkillData.find(skill => skill.sid === sid)
      return {
        sid,
        name: target ? target.name : '未知技能',
        level: userRating[sid] || 0
      }
    })
  
    const userTidList = userState.tid_list || []
  
    // 2. 过滤当前用户队伍
    let rawTeamList = allTeams.filter(team => userTidList.includes(team.tid))
  
    // 收集所有队长、队员、指导老师uid
    const allQueryUids = new Set()
    rawTeamList.forEach(team => {
      if (team.leader) allQueryUids.add(Number(team.leader))
      const memberUids = Object.keys(team.members || {}).map(Number)
      memberUids.forEach(uid => allQueryUids.add(uid))
      // 【新增】指导老师（teams.advisor 数组 + 兼容旧 teacher_uid）
      ;(team.advisor || []).forEach(uid => allQueryUids.add(Number(uid)))
      if (team.teacher_uid) allQueryUids.add(Number(team.teacher_uid))
    })
    const uidArr = Array.from(allQueryUids)
  
    // 批量查询用户昵称
    let userMap = {}
    if (uidArr.length > 0) {
      try {
        const batchRes = await wx.cloud.callFunction({
          name: 'userApi',
          data: {
            action: 'getBatchUids',
            params: { uidList: uidArr }
          }
        })
        if (batchRes.result.code === 0) {
          batchRes.result.data.forEach(user => {
            userMap[user.userInfo.uid] = user.userInfo.username
          })
        }
      } catch (err) {
        console.error('批量查询用户失败', err)
      }
    }
  
    // 组装队伍展示数据
    let myTeamList = rawTeamList.map(team => {
      const compNames = team.cid_list
        .map(cid => {
          const target = allComp.find(c => c.cid === cid)
          return target ? target.name : ''
        })
        .filter(Boolean)
      const matchName = compNames.length ? compNames.join('、') : '暂未参赛'
  
      const leaderUid = Number(team.leader)
      const leaderName = userMap[leaderUid] || '暂无'
  
      const memberUidList = Object.keys(team.members || {}).map(Number)
      const realMemberUids = memberUidList.filter(uid => uid !== leaderUid)
      // 队员直接拼接成字符串，wxml无需join
      const memberNamesStr = realMemberUids.map(uid => userMap[uid] || '未知用户').join('、')
      // 【新增】指导老师（teams.advisor 数组 + 兼容旧 teacher_uid）
      const advisorUids = [...new Set([
        ...(team.advisor || []).map(Number),
        ...(team.teacher_uid ? [Number(team.teacher_uid)] : [])
      ])]
      const advisorNamesStr = advisorUids.map(uid => userMap[uid] || '未知用户').join('、')

      return {
        teamId: team.tid,
        teamName: team.name,
        isPersonal: !!team.isPersonal, // 【新增】个人参赛标识（单人队伍）
        leaderName,
        members: memberNamesStr, // 字符串，不是数组
        advisors: advisorNamesStr, // 【新增】指导老师（逗号拼接）
        matchName
      }
    })
  
    this.setData({
      isLogin: true,
      userInfo: { name: userName, intro: userIntro },
      userAvatar,
      skillList: userSkillNames, // 转换后的用户技能名称数组（弹窗逻辑依赖，勿改结构）
      skillTagList, // 技能标签 + 等级（卡片染色用）
      originSkillList,
      teamList: myTeamList
    })

    // ========== 【新增】查询个人匹配池（用户类型） ==========
    const uid = userState.userInfo.uid
    let myMatchList = []
    if (uid) {
      try {
        const poolRes = await wx.cloud.callFunction({
          name: 'matching_poolApi',
          data: { action: 'getMyPool', params: { uid } }
        })
        if (poolRes.result.code === 0) {
          const records = poolRes.result.data || []
          myMatchList = records.flatMap(record =>
            (record.match_items || []).map(item => {
              const comp = allComp.find(c => Number(c.cid) === Number(item.cid))
              const skills = (item.match_skill || []).map(sid => {
                const target = allSkillData.find(s => Number(s.sid) === Number(sid))
                return {
                  sid: Number(sid),
                  name: target ? target.name : '未知技能',
                  level: userRating[sid] || 0
                }
              })
              return {
                cid: item.cid,
                compName: comp ? (comp.name || comp.title || '未知赛事') : '未知赛事',
                skills
              }
            })
          )
        }
      } catch (err) {
        console.error('查询个人匹配池失败', err)
      }
    }
    this.setData({ myMatchList })
  },

  // 跳转登录/个人资料
  goUserInfo() {
    const userState = store.user.getUserInfo()
    if (!userState.profileComplete) {
      wx.navigateTo({ url: '/subPackages/user/profile_register' })
    } else {
      wx.navigateTo({ url: '/subPackages/user/profile' })
    }
  },

  // 打开技能弹窗
  editSkill() {
    this.setData({
      showSkillPopup: true,
      currentSkillInput: "",
      searchMatchList: [],
      tempSkillList: [...this.data.skillList] // 拷贝正式列表作为初始值
    })
  },

  closeSkillPopup() {
    this.setData({ showSkillPopup: false })
  },

  // 技能搜索联想过滤
  onSkillInput(e) {
    const keyword = e.detail.trim()
    this.setData({ currentSkillInput: keyword })
    if (!keyword) {
      this.setData({ searchMatchList: [] })
      return
    }
  
    // 分词：按空格分割，过滤空字符
    const keywords = keyword.split(/\s+/).filter(w => w.length > 0)
    const lowerKeywords = keywords.map(w => w.toLowerCase())
  
    // 过滤已选技能（tempSkillList 是名称数组）
    const selectedNames = this.data.tempSkillList
  
    // 从原始技能列表中搜索
    const matchList = this.data.originSkillList.filter(skill => {
      // 排除已选技能
      if (selectedNames.includes(skill.name)) return false
  
      const nameLower = skill.name.toLowerCase()
      const descLower = skill.desc.toLowerCase()
  
      // 所有关键词都必须匹配（AND 逻辑），可在 name 或 desc 中匹配
      return lowerKeywords.every(keyword => 
        nameLower.includes(keyword) || descLower.includes(keyword)
      )
    })
  
    // 将匹配结果映射为展示对象（名称 + 描述片段）
    const searchResult = matchList.map(skill => ({
      name: skill.name,
      desc: skill.desc,
      // 描述片段：取前 30 个字符，并截断
      descSnippet: skill.desc ? skill.desc.slice(0, 30) + (skill.desc.length > 30 ? '...' : '') : ''
    }))
  
    this.setData({ searchMatchList: searchResult })
  },

  // 点击联想快速添加技能
  selectSuggest(e) {
    const skillName = e.currentTarget.dataset.name
    const newTempList = [...this.data.tempSkillList, skillName]
    this.setData({
      tempSkillList: newTempList,
      currentSkillInput: "",
      searchMatchList: []
    })
  },

  // 删除单个技能标签
  removeSkillTag(e) {
    const index = e.currentTarget.dataset.index
    const tempList = [...this.data.tempSkillList]
    tempList.splice(index, 1)
    // 仅修改临时列表
    this.setData({ tempSkillList: tempList })
  },

  /**
   * 统一同步：页面data + store.user + globalData
   */
  syncSkillAllSource(newSkillArr) {
    // 同步重建带等级的技能标签（新技能无评级 -> 0 灰色兜底）
    const userState = store.user.getUserInfo()
    const rating = userState.userInfo.skill_rating || {}
    const skillTagList = newSkillArr.map(name => {
      const sid = store.skills.getIdByName(name)
      return { sid: sid || 0, name, level: rating[sid] || 0 }
    })
    this.setData({
      skillList: newSkillArr,
      skillTagList,
      currentSkillInput: "",
      searchMatchList: []
    })
    // 同步store user技能状态
    store.user.clearSkills()
    newSkillArr.forEach(name => {
      const sid = store.skills.getIdByName(name)
      if (sid) store.user.addSkill(sid)
    })
  },

  // 保存技能到云端
  async saveSkill() {
    // 1. 处理输入：合并临时列表与手动输入的技能，去重
    const inputStr = this.data.currentSkillInput.trim()
    let skillNameList = [...this.data.tempSkillList]
    
    if (inputStr) {
      const inputNames = inputStr
        .split(',')
        .map(item => item.trim())
        .filter(item => item)
      skillNameList = [...new Set([...skillNameList, ...inputNames])]
    }

    // 2. 登录态与权限校验
    const userState = store.user.getUserInfo()
    if (!userState.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }
    const uid = userState.userInfo.uid
    if (!uid || uid === -1) {
      wx.showToast({ title: '请先完善个人信息', icon: 'none' })
      return
    }

    // 3. 技能名称转 sid，过滤无效技能
    const sidList = skillNameList
      .map(name => store.skills.getIdByName(name))
      .filter(sid => sid !== undefined && sid !== null)

    try {
      // 4. 单次请求，批量覆盖更新云端技能
      await wx.cloud.callFunction({
        name: 'userApi',
        data: {
          action: 'setSkillList',
          params: { uid, skillList: sidList }
        }
      })

      // 5. 云端写入成功后，才同步到页面正式状态 + store
      this.syncSkillAllSource(skillNameList)
      this.setData({ showSkillPopup: false })
      wx.showToast({ title: '保存成功' })
    } catch (err) {
      console.error('保存技能失败：', err)
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  },

  // 队伍详情跳转
  goTeamDetail(e) {
    const tid = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/subPackages/team/team_info?tid=${tid}` })
  },

  // ========== 【新增】个人匹配池：查看匹配结果（跳转到 team_list 个人模式，展示匹配到的队伍） ==========
  viewMatchResult(e) {
    const cid = e.currentTarget.dataset.cid
    if (!cid) return
    const userState = store.user.getUserInfo()
    const uid = userState.userInfo.uid
    if (!uid) return
    wx.navigateTo({ url: `/subPackages/team/team_list?cid=${cid}&uid=${uid}&isMatch=true` })
  },

  // ========== 【新增】个人匹配池：取消匹配 ==========
  async cancelMatch(e) {
    const cid = e.currentTarget.dataset.cid
    const index = e.currentTarget.dataset.index
    const item = this.data.myMatchList[index]
    if (!item) return
    const userState = store.user.getUserInfo()
    const uid = userState.userInfo.uid
    if (!uid) return
    const modalRes = await wx.showModal({
      title: '取消匹配',
      content: `确认取消「${item.compName}」的匹配？`,
      confirmText: '确认取消'
    })
    if (!modalRes.confirm) return
    wx.showLoading({ title: '取消中...' })
    try {
      const r = await wx.cloud.callFunction({
        name: 'matching_poolApi',
        data: {
          action: 'exitPool',
          params: { type: 'user', targetId: uid, cid: Number(cid) }
        }
      })
      if (r.result.code === 0) {
        await store.user.loadUser()
        wx.hideLoading()
        wx.showToast({ title: '已取消匹配' })
        this.onShow() // 刷新页面
      } else {
        throw new Error(r.result.msg || '取消失败')
      }
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: err.message || '取消失败', icon: 'none' })
    }
  },

  // 个人资料编辑页
  goUserDetail() {
    wx.navigateTo({ url: '/subPackages/user/profile' })
  },

  // 兼容旧方法
  async updateUserSkillToCloud(skillArr) {
    const userState = store.user.getUserInfo()
    const uid = userState.userInfo.uid
    await wx.cloud.callFunction({
      name: 'userApi',
      data: { action: 'setTidList', params: { uid, skillList: skillArr } }
    })
  }
})