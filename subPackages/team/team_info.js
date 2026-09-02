const store = require('../../store/index')

Page({
  data: {
    tid: null,
    team: null,
    selfUid: null,
    isCaptain: false,
    isMember: false,      // 当前用户是否为该队伍成员（含队长）；非队员仅可查看队长主页
    isAdvisor: false,     // 【新增】当前用户是否为该队伍指导老师
    canSeeMembers: false, // 【新增】是否能查看成员列表（队员/队长/指导老师）
    advisorUids: [],      // 【新增】指导老师 uid 列表（teams.advisor + 兼容旧 teacher_uid）
    showTeacherPicker: false,   // 【新增】添加指导老师弹窗
    advisorSearchUid: '',       // 【新增】输入的指导老师 uid
    advisorSearchResult: null,  // 【新增】uid 搜索结果 {uid, username, avatar, institute}
    advisorSearching: false,    // 【新增】搜索中标记
    leaderUid: null,      // 队长 uid（非队员"查看队长主页"入口用）
    userNickMap: {},
    showConfirm: false,
    confirmText: '',
    confirmType: '',
    kickTargetUid: null,
    loadingTeam: false,
    // 成员操作浮层（图标点击后弹出的小选项框）
    showActionSheet: false,
    actionSheetUid: null,
    actionSheetItems: [],
    actionSheetPos: null, // {left, top} 锚定到点击图标旁边
    // 成员主页卡片
    showUserHome: false,
    userHomeInfo: null, // {uid, name, avatar, intro, skillTagList: [{sid, name, level}]}
    // 入队申请
    applyList: [],
    applyCount: 0,
    showApplyPopup: false,
  },

  onLoad(options) {
    const tidRaw = options.tid
    const tid = Number(tidRaw)
    if (isNaN(tid) || !tid) {
      wx.showToast({ title: '队伍ID缺失', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
      return
    }
    this.setData({ tid })
    this.loadTeamAndUserNick(tid)

    this.unsubscribe = store.subscribeModule('teams', () => {
      const currentTid = this.data.tid
      if (!currentTid || this.data.loadingTeam) return
      this.loadTeamAndUserNick(currentTid)
    })
  },

  onShow() {
    // 队长从其他页面返回/重新进入时刷新入队申请列表与红点
    if (this.data.isCaptain && this.data.tid) {
      this.loadApplications(this.data.tid)
    }
  },

  onUnload() {
    if (typeof this.unsubscribe === 'function') {
      this.unsubscribe()
      this.unsubscribe = null
    }
  },

  // 下拉刷新：重拉队伍缓存 → 刷新队伍详情与成员列表（队长同时刷新入队申请）
  async onPullDownRefresh() {
    try {
      const tid = this.data.tid
      if (!tid) return
      await store.teams.loadAllTeams()
      await this.loadTeamAndUserNick(tid)
      if (this.data.isCaptain) {
        await this.loadApplications(tid)
      }
    } catch (err) {
      console.error('下拉刷新失败', err)
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  // ========== 【修改】重新实现成员列表排序 ==========
  async loadTeamAndUserNick(tid) {
    // 【修复】用请求序号替代 loadingTeam 布尔守卫：
    // store.teams.loadAllTeams() 完成时会触发订阅回调再次进入本函数，
    // 若用 loadingTeam 拦截会导致 handleApply 中的显式刷新被跳过（成员列表不更新）。
    // 现在允许并发，但只让最新一次请求的结果生效。
    const token = (this._teamLoadToken || 0) + 1
    this._teamLoadToken = token
    this.setData({ loadingTeam: true })
    try {
      await store.user.loadUser()
      const team = store.teams.getByTid(tid)
      console.log(team);
      if (!team) {
        wx.showToast({ title: '队伍不存在', icon: 'none' })
        return
      }
      const userState = store.user.getUserInfo()
      const selfUid = Number(userState.userInfo.uid)
      const leaderNum = Number(team.leader)
      const isCaptain = selfUid === leaderNum
      // 是否队伍成员（含队长）：members 键可能是字符串，统一转数字比较
      const isMember = isCaptain || Object.keys(team.members || {}).some(k => Number(k) === selfUid)

      // 【新增】指导老师 uid 列表（teams.advisor 数组 + 兼容旧单数 teacher_uid 字段）
      const advisorUids = [...new Set([
        ...(team.advisor || []).map(Number),
        ...(team.teacher_uid ? [Number(team.teacher_uid)] : [])
      ])]
      // 当前用户是否为指导老师（可查看成员列表，无管理权限）
      const isAdvisor = advisorUids.includes(selfUid)
      const canSeeMembers = isCaptain || isMember || isAdvisor

      // 收集所有需要显示的用户 uid（队长、指导老师、所有成员）
      const uidSet = new Set()
      uidSet.add(leaderNum)
      advisorUids.forEach(uid => uidSet.add(uid))
      const memberStrUids = Object.keys(team.members || {})
      memberStrUids.forEach(str => uidSet.add(Number(str)))

      const uidNumArr = Array.from(uidSet)
      let userNickMap = {}
      if (uidNumArr.length > 0) {
        try {
          const batchRes = await wx.cloud.callFunction({
            name: 'userApi',
            data: { action: 'getBatchUids', params: { uidList: uidNumArr } }
          })
          if (batchRes.result.code === 0) {
            batchRes.result.data.forEach(item => {
              const uidNum = Number(item.userInfo.uid)
              // 保留 skill_rating（user 文档顶层字段），用于成员技能按等级染色
              userNickMap[uidNum] = {
                name: item.userInfo.username,
                avatar: item.userInfo.avatar || '/subPackages/images/user/user.jpg',
                rating: item.skill_rating || {},
                intro: item.userInfo.introduction || '',
                skills: item.skills || [] // user 顶层 sid 数组
              }
            })
          }
        } catch (err) {
          console.error('批量查询用户昵称失败', err)
        }
      }

      // 免费版：批量把成员 cloud:// 头像转成 https 临时链接（模式同 team_list.js）
      const cloudFiles = Object.values(userNickMap)
        .map(u => u.avatar)
        .filter(a => a && a.startsWith('cloud://'))
      if (cloudFiles.length > 0) {
        try {
          const urlRes = await wx.cloud.callFunction({
            name: 'getFileUrl',
            data: { fileList: cloudFiles }
          })
          const list = (urlRes.result && urlRes.result.fileList) || []
          const urlMap = {}
          list.forEach(f => { urlMap[f.fileID] = f.tempFileURL })
          Object.keys(userNickMap).forEach(uid => {
            const url = urlMap[userNickMap[uid].avatar]
            if (url) userNickMap[uid].avatar = url
          })
        } catch (e) {
          console.warn('队伍成员头像转链失败', e)
        }
      }

      const allComp = store.competition.getList()

      // ---- 构建有序成员列表 ----
      // 1. 从 members 中提取所有成员 uid（包含队长）
      const allMemberUids = Object.keys(team.members || {}).map(Number)
      // 2. 排除队长和指导老师（如果指导老师在 members 中，也排除）
      const excludeUids = new Set([leaderNum, ...advisorUids])
      const memberUids = allMemberUids.filter(uid => !excludeUids.has(uid))

      // 3. 按顺序拼接：队长 → 指导老师 → 队员
      const orderedUids = []
      if (leaderNum) orderedUids.push(leaderNum)
      advisorUids.forEach(uid => { if (uid !== leaderNum) orderedUids.push(uid) })
      orderedUids.push(...memberUids)

      // 4. 生成成员显示对象
      const isAdvisorUid = uid => advisorUids.includes(uid)
      const memberList = orderedUids.map(uid => {
        const skillId = team.members[uid] ? Number(team.members[uid]) : null
        let skillName = '未知技能'
        if (isAdvisorUid(uid)) {
          // 指导老师单独处理：若不在 members 中，显示“指导老师”
          skillName = '指导老师'
        } else if (skillId) {
          skillName = store.skills.getNameById(skillId) || '未知技能'
        }
        // 成员技能等级：该用户 skill_rating 中对应技能 sid 的评级（无则 0 灰）
        const memberRating = (userNickMap[uid] && userNickMap[uid].rating) || {}
        const skillLevel = skillId ? (memberRating[skillId] || 0) : 0
        return {
          uid: uid,
          nickName: userNickMap[uid] ? userNickMap[uid].name : '未知用户',
          avatar: userNickMap[uid] ? userNickMap[uid].avatar : '/subPackages/images/user/user.jpg',
          skillName: skillName,
          skillLevel: skillLevel, // 0-5，用于 wxml 按等级染色
          isCaptain: uid === leaderNum,
          isTeacher: isAdvisorUid(uid)
        }
      })

      const enhancedTeam = {
        ...team,
        compList: (team.cid_list || []).map(cid => {
          const comp = allComp.find(c => c.cid === cid)
          return { cid, compName: comp ? comp.name : '未知赛事' }
        }),
        needList: Object.keys(team.team_missing || {}).map(sid => ({
          sid: Number(sid),
          needNum: team.team_missing[sid],
          skillName: store.skills.getNameById(Number(sid)) || '未知技能'
        })),
        memberList: memberList   // 【修改】使用新构建的有序列表
      }
      if (this._teamLoadToken !== token) return  // 已有更新的加载请求，本次结果作废
      this.setData({
        team: enhancedTeam,
        selfUid,
        isCaptain,
        isMember,
        isAdvisor,
        canSeeMembers,
        advisorUids,
        leaderUid: leaderNum,
        userNickMap
      })
      // 【新增】队长加载入队申请
      if (isCaptain) {
        this.loadApplications(tid)
      } else {
        this.setData({ applyList: [], applyCount: 0 })
      }
    } catch (err) {
      console.error('加载队伍异常', err)
    } finally {
      if (this._teamLoadToken === token) {
        this.setData({ loadingTeam: false })
      }
    }
  },

  // ========== 【新增】入队申请：拉取/弹窗/处理 ==========
  async loadApplications(tid) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'requestApi',
        data: { action: 'getByTeam', params: { tid } }
      })
      if (res.result.code === 0) {
        const list = (res.result.data || []).map(item => ({
          ...item,
          // 【修复】兜底：username 缺失时显示"未知用户"；skillName 后端未返回，前端实时换算
          username: item.username || `用户${item.uid || ''}` || '未知用户',
          skillName: item.skillId
            ? (store.skills.getNameById(Number(item.skillId)) || '未选择技能')
            : '未选择技能'
        }))
        console.log('[loadApplications] tid=', tid, 'list=', list)
        this.setData({ applyList: list, applyCount: list.length })
      } else {
        console.warn('[loadApplications] 非成功返回', res.result)
      }
    } catch (err) {
      console.error('获取入队申请失败', err)
    }
  },

  openApplyPopup() {
    this.setData({ showApplyPopup: true })
  },

  // ========== 【改造】指导老师：输入 uid 搜索 → 发送邀请 ==========
  // 打开"添加指导老师"弹窗：直接弹出输入框，按 uid 搜索老师
  openAdvisorPicker() {
    this.setData({
      showTeacherPicker: true,
      advisorSearchUid: '',
      advisorSearchResult: null,
      advisorSearching: false
    })
  },

  closeAdvisorPicker() {
    this.setData({ showTeacherPicker: false, advisorSearchUid: '', advisorSearchResult: null })
  },

  // 遮罩点击：仅点击遮罩空白处才关闭。
  // 【修复】input 是原生组件，其 tap 事件会穿透 popup-box 的 catchtap 冒泡到遮罩，
  // 若直接 bindtap="closeAdvisorPicker" 会导致点击输入框时整个弹窗消失；
  // 改为按 e.target === e.currentTarget 判断，只有真正点遮罩空白处才关闭。
  onTeacherMaskTap(e) {
    if (e.target === e.currentTarget) {
      this.closeAdvisorPicker()
    }
  },

  onAdvisorUidInput(e) {
    // 仅允许数字：兼容从外部复制粘贴（type="text" 支持粘贴），过滤非数字字符并受控回写
    const digits = String(e.detail.value || '').replace(/\D/g, '')
    this.setData({ advisorSearchUid: digits, advisorSearchResult: null })
  },

  // 根据 uid 搜索指导老师：校验存在 + role=teacher + 不在本队
  async searchAdvisor() {
    const uidStr = String(this.data.advisorSearchUid || '').trim()
    const uid = Number(uidStr)
    if (!uidStr || isNaN(uid) || uid <= 0) {
      wx.showToast({ title: '请输入正确的 uid', icon: 'none' })
      return
    }
    const { team, advisorUids, selfUid } = this.data
    if ((advisorUids || []).includes(uid)) {
      wx.showToast({ title: '该指导老师已在队伍中', icon: 'none' })
      return
    }
    if (team && team.members && team.members[uid]) {
      wx.showToast({ title: '该用户已是队伍成员', icon: 'none' })
      return
    }
    if (uid === Number(selfUid)) {
      wx.showToast({ title: '不能添加自己为指导老师', icon: 'none' })
      return
    }
    this.setData({ advisorSearching: true, advisorSearchResult: null })
    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: { action: 'getByUid', params: { uid } }
      })
      if (res.result.code !== 0 || !res.result.data) {
        wx.showToast({ title: '未找到该 uid 的用户', icon: 'none' })
        return
      }
      const user = res.result.data
      if (user.role !== 'teacher') {
        wx.showToast({ title: '该用户不是老师，无法添加', icon: 'none' })
        return
      }
      const userInfo = user.userInfo || {}
      this.setData({
        advisorSearchResult: {
          uid,
          username: userInfo.username || `用户${uid}`,
          avatar: userInfo.avatar || '/subPackages/images/user/user.jpg',
          institute: userInfo.institute || ''
        }
      })
    } catch (err) {
      console.error('搜索指导老师失败', err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    } finally {
      this.setData({ advisorSearching: false })
    }
  },

  // 向指导老师发送邀请：老师收到后在消息中心手动同意，同意后进入 teams.advisor，不占 members
  async inviteAdvisor(e) {
    const uid = e.currentTarget.dataset.uid
    if (!uid) return
    const { tid, team } = this.data
    if (!team.cid_list || team.cid_list.length === 0) {
      wx.showToast({ title: '请先绑定赛事', icon: 'none' })
      return
    }
    wx.showLoading({ title: '发送邀请...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'requestApi',
        data: {
          action: 'create',
          params: {
            type: 'invite',
            subType: 'advisor',
            tid,
            uid: Number(uid),
            cid: team.cid_list[0],
            skillId: 0
          }
        }
      })
      wx.hideLoading()
      if (res.result.code === 0) {
        wx.showToast({ title: '邀请已发送，等待老师同意', icon: 'none' })
        this.setData({ showTeacherPicker: false, advisorSearchUid: '', advisorSearchResult: null })
      } else {
        wx.showToast({ title: res.result.msg || '邀请失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('发送指导老师邀请失败', err)
      wx.showToast({ title: err.message || '网络异常', icon: 'none' })
    }
  },

  closeApplyPopup() {
    this.setData({ showApplyPopup: false })
  },

  async handleApply(e) {
    const { id, action } = e.currentTarget.dataset
    if (!id) return
    wx.showLoading({ title: '处理中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'requestApi',
        data: { action: 'handle', params: { requestId: id, action } }
      })
      wx.hideLoading()
      if (res.result.code === 0) {
        wx.showToast({ title: action === 'accept' ? '已同意入队' : '已拒绝', icon: 'success' })
        await store.teams.loadAllTeams()
        await this.loadTeamAndUserNick(this.data.tid)
        this.loadApplications(this.data.tid)
      } else {
        wx.showToast({ title: res.result.msg || '操作失败', icon: 'none' })
        this.loadApplications(this.data.tid)
      }
    } catch (err) {
      wx.hideLoading()
      console.error('处理申请失败', err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  // ========== 【新增】跳转编辑页 ==========
  editTeam() {
    const { tid, team } = this.data
    // 若队伍处于匹配状态，阻止跳转并提示
    if (team.is_matching) {
      wx.showToast({
        title: '请先关闭匹配招募再编辑',
        icon: 'none',
        duration: 2000
      })
      return
    }
    wx.navigateTo({
      url: `/subPackages/team/team_push?tid=${tid}`
    });
  },

  // 复制 TID
  copyTid() {
    wx.setClipboardData({
      data: String(this.data.tid),
      success: () => wx.showToast({ title: '已复制TID' })
    })
  },

  copyCid(e) {
    const cid = e.currentTarget.dataset.cid
    wx.setClipboardData({
      data: String(cid),
      success: () => wx.showToast({ title: '已复制CID' })
    })
    e.stopPropagation()
  },

  goCompPage(e) {
    const cid = e.currentTarget.dataset.cid
    wx.navigateTo({ url: `/subPackages/comp/comp_info?cid=${cid}` })
  },

  onMemberItemTap(e) {
    const uidNum = e.currentTarget.dataset.uid
    const { selfUid, isCaptain, advisorUids } = this.data
    const isSelf = uidNum === selfUid
    const isTeacher = (advisorUids || []).includes(uidNum)

    // 按状态生成小选项框内容（指导老师不占 members，不可退出/踢出）
    let items = []
    if (isTeacher) {
      items = [{ key: 'view', label: '查看主页' }]
      // 队长可移除指导老师
      if (isCaptain && !isSelf) {
        items.push({ key: 'removeAdvisor', label: '移除指导老师', danger: true })
      }
    } else if (isSelf && isCaptain) {
      items = [{ key: 'disband', label: '解散小队' }]
    } else if (isSelf && !isCaptain) {
      items = [{ key: 'quit', label: '退出小队' }]
    } else if (isCaptain && !isSelf) {
      items = [
        { key: 'view', label: '查看主页' },
        { key: 'kick', label: '踢出队伍', danger: true }
      ]
    } else {
      items = [{ key: 'view', label: '查看主页' }]
    }
    // 浮层锚定到点击图标旁边：默认展开在图标左侧偏下，越界时自动钳制
    const touch = e.touches && e.touches[0] ? e.touches[0] : { clientX: 300, clientY: 300 }
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const sheetW = 140 // 260rpx 约 130px，预留余量
    const left = Math.max(8, Math.min(touch.clientX - sheetW - 8, sys.windowWidth - sheetW - 8))
    const top = touch.clientY + 16
    this.setData({
      showActionSheet: true,
      actionSheetUid: uidNum,
      actionSheetItems: items,
      actionSheetPos: { left, top }
    })
  },

  // 关闭成员操作浮层
  closeActionSheet() {
    this.setData({ showActionSheet: false, actionSheetUid: null, actionSheetItems: [], actionSheetPos: null })
  },

  // 浮层内点击具体项
  onActionItemTap(e) {
    const key = e.currentTarget.dataset.key
    const uid = this.data.actionSheetUid
    this.closeActionSheet()
    switch (key) {
      case 'disband':
        this.setData({
          showConfirm: true,
          confirmText: '确定解散该队伍？所有成员将被移出',
          confirmType: 'disband'
        })
        break
      case 'quit':
        this.setData({
          showConfirm: true,
          confirmText: '确定退出当前队伍？退出后需要重新进入匹配',
          confirmType: 'quit'
        })
        break
      case 'view':
        this.openUserHome(uid)
        break
      case 'kick': {
        const nick = (this.data.userNickMap[uid] && this.data.userNickMap[uid].name) || '该成员'
        this.setData({
          showConfirm: true,
          confirmText: `确定踢出用户${nick}？`,
          confirmType: 'kick',
          kickTargetUid: uid
        })
        break
      }
      case 'removeAdvisor': {
        const nick = (this.data.userNickMap[uid] && this.data.userNickMap[uid].name) || '该指导老师'
        this.setData({
          showConfirm: true,
          confirmText: `确定移除指导老师${nick}？`,
          confirmType: 'removeAdvisor',
          kickTargetUid: uid
        })
        break
      }
    }
  },

  // 打开成员主页卡片（含头像/昵称/简介/技能/邮箱，按 user 页面等级染色）
  openUserHome(uid) {
    const u = this.data.userNickMap[uid] || {}
    const allSkillData = store.skills.getAll()
    const rating = u.rating || {}
    const skillTagList = (u.skills || []).map(sid => {
      const target = allSkillData.find(s => s.sid === sid)
      return {
        sid,
        name: target ? target.name : '未知技能',
        level: rating[sid] || 0
      }
    })
    // 自己的邮箱直接从 store 透出；队友邮箱留空，由"获取邮箱"按钮触发云函数拉取
    const isSelf = Number(uid) === Number(this.data.selfUid)
    let email = ''
    if (isSelf) {
      const userState = store.user.getUserInfo()
      email = (userState.userInfo && userState.userInfo.email) || ''
    }
    this.setData({
      showUserHome: true,
      userHomeInfo: {
        uid,
        name: u.name || '未知用户',
        avatar: u.avatar || '/subPackages/images/user/user.jpg',
        intro: u.intro || '',
        skillTagList,
        email,
        isSelf
      }
    })
  },

  // 关闭成员主页卡片
  closeUserHome() {
    this.setData({ showUserHome: false, userHomeInfo: null })
  },

  // 非队员入口：查看队长主页
  openLeaderHome() {
    const { leaderUid } = this.data
    if (!leaderUid) return
    this.openUserHome(leaderUid)
  },

  // 获取队友邮箱（简化版：同队成员直接展示+复制；云函数 getContact 已做同队校验）
  async getContact() {
    const { tid, userHomeInfo } = this.data
    if (!userHomeInfo || !userHomeInfo.uid) return
    wx.showLoading({ title: '获取中...', mask: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'userApi',
        data: {
          action: 'getContact',
          params: { tid, targetUid: userHomeInfo.uid }
        }
      })
      wx.hideLoading()
      if (res.result && res.result.code === 0 && res.result.data) {
        const email = res.result.data.email || ''
        if (!email) {
          wx.showToast({ title: '对方未填写邮箱', icon: 'none' })
          return
        }
        this.setData({ 'userHomeInfo.email': email })
        wx.setClipboardData({
          data: email,
          success: () => wx.showToast({ title: '已复制邮箱' })
        })
      } else {
        wx.showToast({ title: (res.result && res.result.msg) || '获取失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      console.error('获取邮箱失败', err)
      wx.showToast({ title: '网络异常', icon: 'none' })
    }
  },

  // 复制已展示的邮箱
  copyHomeEmail() {
    const email = this.data.userHomeInfo && this.data.userHomeInfo.email
    if (!email) return
    wx.setClipboardData({
      data: email,
      success: () => wx.showToast({ title: '已复制邮箱' })
    })
  },

  // ========== 匹配：队伍入池 ==========
  // 【新增】查看匹配结果：跳转到队伍列表页并打开匹配推荐弹窗（与 openMatch 相同跳转，但不重新入池）
  viewMatchResult() {
    const { tid, team } = this.data
    if (!team || !team.cid_list || team.cid_list.length === 0) {
      wx.showToast({ title: '无绑定赛事', icon: 'none' })
      return
    }
    const firstCid = team.cid_list[0]
    wx.navigateTo({
      url: `/subPackages/team/team_list?cid=${firstCid}&tid=${tid}&isMatch=true`
    })
  },

  // ========== 【改造】开启匹配：所有绑定赛事全部入池 ==========
async openMatch() {
  const { tid, team } = this.data
  if (!team.cid_list || team.cid_list.length === 0) {
    wx.showToast({ title: '请先绑定赛事', icon: 'none' })
    return
  }
  // 【拦截】仅主动邀请（condition===2）的队伍无法开启匹配
  if (Number(team.condition) === 2) {
    wx.showToast({ title: '仅主动邀请的队伍无法开启匹配', icon: 'none' })
    return
  }
  try {
    // 顺序执行，避免并发竞态
    for (const cid of team.cid_list) {
      const res = await wx.cloud.callFunction({
        name: 'matching_poolApi',
        data: {
          action: 'enterPool',
          params: {
            type: 'team',
            targetId: tid,
            cid: cid
          }
        }
      })
      if (res.result.code !== 0) {
        throw new Error(res.result.msg || `赛事 ${cid} 入池失败`)
      }
    }
    // 刷新 store 缓存
    await store.teams.loadAllTeams()
    await this.loadTeamAndUserNick(tid)
    wx.showToast({ title: '已开启匹配招募（所有绑定赛事）' })

    // ========== 【新增】跳转到队伍列表页，显示匹配推荐 ==========
    // 取第一个赛事作为匹配推荐的目标
    const firstCid = team.cid_list[0]
    wx.navigateTo({
      url: `/subPackages/team/team_list?cid=${firstCid}&tid=${tid}&isMatch=true`
    })
  } catch (err) {
    console.error('开启匹配失败', err)
    const errMsg = String((err && err.errMsg) || (err && err.message) || '')
    const tip = errMsg.includes('暂无技能缺口')
      ? '队伍暂无技能缺口，请先编辑队伍设置招募需求'
      : errMsg || '部分赛事匹配失败'
    wx.showToast({ title: tip, icon: 'none' })
  }
},

// ========== 【改造】关闭匹配：关闭所有赛事的匹配 ==========
async closeMatch() {
  const { tid, team } = this.data
  if (!team.cid_list || team.cid_list.length === 0) {
    wx.showToast({ title: '无绑定赛事', icon: 'none' })
    return
  }
  try {
    const res = await wx.cloud.callFunction({
      name: 'matching_poolApi',
      data: {
        action: 'exitPool',
        params: {
          type: 'team',
          targetId: tid
          // 不传 cid，清空全部
        }
      }
    })
    if (res.result.code === 0) {
      // ★ 关键：刷新 store 队伍缓存
      await store.teams.loadAllTeams()
      // 重新加载当前队伍数据
      await this.loadTeamAndUserNick(tid)
      wx.showToast({ title: '已关闭所有匹配招募' })
    } else {
      wx.showToast({ title: res.result.msg || '关闭匹配失败', icon: 'none' })
    }
  } catch (err) {
    console.error('关闭匹配失败', err)
    wx.showToast({ title: '网络异常', icon: 'none' })
  }
},

  closeConfirmPopup() {
    this.setData({ showConfirm: false, kickTargetUid: null })
  },

  async confirmOperate() {
    const { confirmType, tid, kickTargetUid, selfUid } = this.data
    let res
    switch (confirmType) {
      case 'disband':
        res = await store.teams.deleteTeam(tid)
        if (res.code === 0) {
          wx.showToast({ title: '队伍已解散' })
          // 【新增】同步刷新本地 user.tid_list（云函数已清理数据库，此处仅同步前端缓存）
          store.user.removeTid(tid)
          setTimeout(() => wx.navigateBack(), 1200)
        }
        break
      case 'quit':
        res = await store.teams.removeMember(tid, selfUid)
        if (res.code === 0) {
          wx.showToast({ title: '已退出队伍' })
          // 【新增】同步刷新本地 user.tid_list（云函数已清理数据库，此处仅同步前端缓存）
          store.user.removeTid(tid)
          setTimeout(() => wx.navigateBack(), 1200)
        }
        break
      case 'kick':
        res = await store.teams.removeMember(tid, kickTargetUid)
        if (res.code === 0) {
          wx.showToast({ title: '已移出成员' })
          // 【修复】显式刷新队伍数据 + 成员列表，不依赖订阅链路（订阅可能被 loadingTeam 拦截）
          await store.teams.loadAllTeams()
          await this.loadTeamAndUserNick(tid)
        }
        break
      case 'removeAdvisor':
        res = await store.teams.removeAdvisor(tid, kickTargetUid)
        if (res.code === 0) {
          wx.showToast({ title: '已移除指导老师' })
          await store.teams.loadAllTeams()
          await this.loadTeamAndUserNick(tid)
        }
        break
    }
    if (res && res.code !== 0) wx.showToast({ title: res.msg, icon: 'none' })
    this.closeConfirmPopup()
  }
})