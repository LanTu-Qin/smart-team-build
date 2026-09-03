// 导入全局store（根据你的项目路径修改）
const store = require('../../store/index')
Page({
  data: {
    loading: true,
    cid: '',
    detail: null,
    posterUrl: '',
    detailLines: [], // 竞赛详情行数组
    suggestLines: [], // 备赛建议行数组
    isAdmin: false, // 管理员可见「AI生成详情」按钮
    aiGenerating: false, // AI 生成中防重复点击

    // ========== 【新增】个人参赛（方案A：单人队伍） ==========
    signMode: '',            // 赛事参赛模式：team（团体）/ personal（个人）/ mixed（个人+团队）
    showSignModePopup: false,   // 混合赛事：参赛模式选择弹窗
    showPersonalSignPopup: false, // 个人参赛：技能选择弹窗
    personalSkillOptions: [], // 用户可选技能 [{sid, name}]
    personalSkillIndex: 0,    // 选中技能下标
    personalSigning: false    // 报名中防重复
  },
  /**
   * 页面加载，同步首页加载4个模块数据
   */
  async onLoad(options) {
    const {
      cid
    } = options
    if (!cid) {
      wx.showToast({
        title: '缺少赛事ID',
        icon: 'none'
      })
      this.setData({
        loading: false
      })
      return
    }
    this.setData({
      cid,
      loading: true
    })
    try {
      // 统一封装获取最新单条赛事方法，保证每次拿最新缓存
      const getCurrentTarget = () => {
        const list = store.competition.getList()
        return list.find(item => Number(item.cid) === Number(cid))
      }
      // 初次获取缓存
      let target = getCurrentTarget()
      if (!target) {
        wx.showToast({
          title: '赛事不存在',
          icon: 'none'
        })
        this.setData({
          loading: false
        })
        return
      }
      // 同步管理员权限（控制「AI生成详情」按钮显隐）
      this.setData({ isAdmin: store.user.state.isAdmin })

      // 【修改】不再在用户进入详情页时自动触发 AI 生成（避免每次访问都调模型、内容还来不及生成）
      // 详情为空时展示占位内容，由管理员在「赛事管理」后台统一生成 / 详情页手动生成
      const emptyContent = !target.content || target.content.includes('这里是赛事详情的写死占位内容')
      if (emptyContent) {
        target.content = "这里是赛事详情的写死占位内容。\n\n赛事名称：中国国际“互联网+”大学生创新创业大赛\n赛事简介：该赛事旨在深化高等教育综合改革，激发大学生的创造力，培养造就“大众创业、万众创新”的生力军。"
      }
      this.setData({
        detail: target
      })
      this.updateDetailContent(target)

      // 海报：若该赛事已带临时链接（首页 getBanner 或本页拉取后已回写）→ 直接复用，不再重复转换；
      // 否则若存有海报 fileID → 拉取转换；两者都没有 → 显示"暂无海报"占位
      if (target.posterUrl) {
        this.setData({
          posterUrl: target.posterUrl
        })
      } else if (target.poster) {
        await this.getSinglePoster(cid)
      } else {
        this.setData({
          posterUrl: ''
        })
      }
    } catch (err) {
      console.error('页面加载失败：', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    } finally {
      this.setData({
        loading: false
      })
    }
  },
  // 管理员手动触发 AI 生成 / 刷新详情
  async regenerateDetail() {
    const cid = this.data.cid
    const detail = this.data.detail
    if (!detail || this.data.aiGenerating) return
    if (!this.data.isAdmin) {
      wx.showToast({ title: '无管理员权限', icon: 'none' })
      return
    }
    this.setData({ aiGenerating: true })
    wx.showLoading({ title: 'AI生成中...' })
    try {
      const aiRes = await store.competition.aiGenerateDetail(cid, detail.name || detail.title, detail.url || '')
      if (aiRes.code === 0) {
        // 等待缓存刷新后重新读取最新数据
        await store.competition.loadCompetition()
        const list = store.competition.getList()
        const target = list.find(item => Number(item.cid) === Number(cid))
        if (target) {
          this.setData({ detail: target })
          this.updateDetailContent(target)
          wx.showToast({ title: '生成成功' })
        }
      } else {
        wx.showToast({ title: aiRes.msg || '生成失败', icon: 'none' })
      }
    } catch (err) {
      console.error('AI生成详情异常', err)
      wx.showToast({ title: '生成异常', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ aiGenerating: false })
    }
  },
  // 获取单赛事海报（poster fileID → 临时链接）
  // 成功后把临时链接回写 store 列表缓存：下次进入详情时直接复用，避免重复调用转换
  async getSinglePoster(cid) {
    const res = await wx.cloud.callFunction({
      name: 'competitionApi',
      data: {
        action: 'getFileTempUrl',
        params: {
          cidList: [cid],
          fieldType: 'image'
        }
      }
    })
    if (res.result.code === 0 && res.result.data.length) {
      const url = res.result.data[0].posterUrl
      if (url) {
        // 回写全局缓存（与 store/competition.getBanner 一致，便于再次进入直接命中）
        const list = store.competition.getList()
        const item = list.find(it => Number(it.cid) === Number(cid))
        if (item) item.posterUrl = url
        // 直接使用临时链接，不追加 ?t= 等参数，避免破坏链接签名导致加载失败
        this.setData({
          posterUrl: url
        })
      }
    }
  },
  // 发布队伍按钮点击
  goSign() {
    const {
      detail,
      cid
    } = this.data
    // 【修改】未开始/报名中均可发布队伍，仅已结束拦截（与后端 checkCompActive 保持一致）
    if (detail.status === '已结束') {
      wx.showToast({
        title: '赛事已结束，无法发布队伍',
        icon: 'none'
      })
      return
    }
    wx.navigateTo({
      url: `/subPackages/team/team_push?cid=${cid}`
    })
  },
  // 匹配按钮点击：跳转到用户匹配配置页（user_push）
  async goMatch() {
    const {
      detail,
      cid
    } = this.data
    if (detail.status === '已结束') {
      wx.showToast({
        title: '赛事已结束，不可匹配',
        icon: 'none'
      })
      return
    }
    // 【优化】点击后立刻给 loading 反馈，避免 await 云函数时用户看不到反应
    wx.showLoading({ title: '加载中...', mask: true })
    // 【修复】详情页 onLoad 未刷新 store，直接读 store.user.onGoing_cid / store.teams.list
    //      可能是旧数据，导致 1/2/3 号拦截全部失效而落到 navigateTo。先刷新再校验。
    try {
      await Promise.all([store.user.loadUser(), store.teams.loadAllTeams()])
    } catch (e) {
      console.warn('goMatch 数据预刷新失败', e)
    }
    wx.hideLoading()
    // 【修改】重复参赛判定基于“用户当前所属队伍”，onGoing_cid 是参赛记录（个人报名会写入），不再拦截
    const userState = store.user.getUserInfo()
    const onGoingCids = userState.onGoing_cid || []
    // 1) 是否已达同时参赛上限（与 teamsApi 后端 MAX_ONGOING_CID=5 保持一致）
    const MAX_ONGOING_CID = 5
    if (onGoingCids.length >= MAX_ONGOING_CID) {
      wx.showToast({ title: `同时参赛最多${MAX_ONGOING_CID}场，已达上限`, icon: 'none' })
      return
    }
    // 2) 用户参与的队伍中已有队伍绑定该赛事（cid_list 含当前 cid）→ 拦截
    const tidList = userState.tid_list || []
    const myTeams = (store.teams.getList() || []).filter(t => tidList.includes(t.tid))
    const boundTeam = myTeams.find(t => (t.cid_list || []).includes(cid))
    if (boundTeam) {
      wx.showToast({ title: '您已有队伍参加该赛事', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: `/subPackages/user/user_push?cid=${cid}`
    })
  },

  // ========== 【新增】个人参赛（方案A：单人队伍） ==========
  // 混合赛事（个人/团队）：模式选择弹窗
  openSignModePopup() {
    this.setData({ showSignModePopup: true })
  },
  closeSignModePopup() {
    this.setData({ showSignModePopup: false })
  },
  choosePersonalFromPopup() {
    this.setData({ showSignModePopup: false })
    this.goPersonalSign()
  },
  chooseTeamSign() {
    this.setData({ showSignModePopup: false })
    this.goSign()
  },
  chooseTeamMatch() {
    this.setData({ showSignModePopup: false })
    this.goMatch()
  },

  // 个人参赛：校验登录/身份/上限/重复后弹出技能选择
  async goPersonalSign() {
    const detail = this.data.detail
    if (detail.status === '已结束') {
      wx.showToast({ title: '赛事已结束，不可参赛', icon: 'none' })
      return
    }
    const userState = store.user.getUserInfo()
    const uid = userState.userInfo.uid
    if (!uid || uid === -1) {
      wx.showToast({ title: '请先完善个人信息并绑定学号/工号', icon: 'none' })
      return
    }
    // 刷新用户与队伍数据，避免拦截基于旧缓存
    wx.showLoading({ title: '加载中...', mask: true })
    try {
      await Promise.all([store.user.loadUser(), store.teams.loadAllTeams()])
    } catch (e) {
      console.warn('goPersonalSign 数据预刷新失败', e)
    }
    wx.hideLoading()
    const uState = store.user.getUserInfo()
    // 1) 同时参赛上限（与后端 MAX_ONGOING_CID=5 一致）
    const MAX_ONGOING_CID = 5
    if ((uState.onGoing_cid || []).length >= MAX_ONGOING_CID) {
      wx.showToast({ title: `同时参赛最多${MAX_ONGOING_CID}场，已达上限`, icon: 'none' })
      return
    }
    // 2) 已有队伍参加该赛事 → 拦截（含之前的个人参赛队伍）
    const tidList = uState.tid_list || []
    const myTeams = (store.teams.getList() || []).filter(t => tidList.includes(t.tid))
    const boundTeam = myTeams.find(t => (t.cid_list || []).includes(Number(this.data.cid)))
    if (boundTeam) {
      wx.showToast({ title: '您已有队伍参加该赛事', icon: 'none' })
      return
    }
    // 3) 用户技能（个人参赛必须选一个技能）
    const skills = store.skills.getAll() || []
    const userSids = uState.skills || []
    const skillOptions = skills
      .filter(s => userSids.includes(s.sid))
      .map(s => ({ sid: s.sid, name: s.name }))
    if (skillOptions.length === 0) {
      wx.showToast({ title: '请先完善技能后再参赛', icon: 'none' })
      return
    }
    this.setData({ personalSkillOptions: skillOptions, personalSkillIndex: 0, showPersonalSignPopup: true })
  },

  closePersonalSignPopup() {
    this.setData({ showPersonalSignPopup: false })
  },

  onPersonalSkillChange(e) {
    this.setData({ personalSkillIndex: Number(e.detail.value) })
  },

  // 确认个人参赛：创建单人队伍（isPersonal=true）
  async submitPersonalSign() {
    if (this.data.personalSigning) return
    const detail = this.data.detail
    const userState = store.user.getUserInfo()
    const uid = userState.userInfo.uid
    const skill = this.data.personalSkillOptions[this.data.personalSkillIndex]
    if (!skill) {
      wx.showToast({ title: '请选择参赛技能', icon: 'none' })
      return
    }
    this.setData({ personalSigning: true })
    wx.showLoading({ title: '报名中...', mask: true })
    try {
      const teamInfo = {
        cid_list: [Number(this.data.cid)],
        leader: uid,
        members: { [uid]: skill.sid },
        condition: 2,
        name: `${userState.userInfo.username || '用户'}的个人参赛`,
        maxNum: 1,
        team_needs: {},
        intro: `个人参赛：${detail.name || detail.title || ''}`,
        is_matching: false,
        isPersonal: true
      }
      const res = await store.teams.createTeam(teamInfo)
      if (res.code === 0) {
        const tid = res.data.tid
        // 关联用户与队伍（tid_list），使"我的队伍"可见
        const resUser = await store.user.setTid(tid)
        if (resUser.code !== 0) console.warn('个人参赛队伍关联失败', resUser)
        // 刷新缓存
        try {
          await Promise.all([store.user.loadUser(), store.teams.loadAllTeams()])
        } catch (e) {
          console.warn('个人参赛后刷新缓存失败', e)
        }
        wx.hideLoading()
        this.setData({ personalSigning: false, showPersonalSignPopup: false, showSignModePopup: false })
        wx.showToast({ title: '报名成功', icon: 'success' })
      } else {
        wx.hideLoading()
        this.setData({ personalSigning: false })
        wx.showToast({ title: res.msg || '报名失败', icon: 'none' })
      }
    } catch (err) {
      wx.hideLoading()
      this.setData({ personalSigning: false })
      console.error('个人参赛失败', err)
      wx.showToast({ title: err.message || '网络异常', icon: 'none' })
    }
  },

  goWebsite() {
    const url = this.data.detail.url;
    if (!url) return;

    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({
          title: '官网链接已复制，请在浏览器中打开',
          icon: 'none',
          duration: 3000
        });
      },
      fail: () => {
        wx.showToast({
          title: '复制失败，请手动复制',
          icon: 'none'
        });
      }
    });
  },
  // 解析赛事介绍文本，适配最新数据库 2.0 的 content 结构：
  //   - 章节标题（赛事动态 / 赛事简介 / 赛事含金量 单独成行）→ title
  //   - 标签行（"主办/承办单位：xxx"、"赛事定位：xxx" 等键值对）→ label
  //   - 数字 / 圆点开头的列表项 → list
  //   - 其余 → 普通段落 text
  parseContentToLines(text) {
    if (!text) return [];

    // 章节标题：整行命中时视为标题（不带冒号）
    const sectionTitles = ['赛事动态', '赛事简介', '赛事含金量', '赛事奖项', '备赛建议', '参赛要求', '注意事项'];

    return text
      .split('\n') // 按换行分割
      .map(line => line.trim()) // 去除首尾空格
      .filter(line => line.length > 0) // 过滤空行
      .map(line => {
        // 1. 章节标题
        if (sectionTitles.includes(line)) {
          return { type: 'title', text: line };
        }
        // 2. 标签行：全角冒号前为标签名（≤14 字符且不含句读标点），如 "主办/承办单位：xxx"
        const colonIdx = line.indexOf('：');
        if (colonIdx > 0 && colonIdx <= 14) {
          const label = line.substring(0, colonIdx).trim();
          const value = line.substring(colonIdx + 1).trim();
          if (label && value && !/[。；，、]/.test(label)) {
            return { type: 'label', label, text: value };
          }
        }
        // 3. 列表项（数字开头、圆点、圈号等）
        if (/^[\d①②③④⑤⑥⑦⑧⑨⑩]+[\.、\)）]/.test(line) || /^[•·●○◆◇]/.test(line)) {
          return { type: 'list', text: line.replace(/^[•·●○◆◇]\s*/, '') };
        }
        // 4. 普通段落
        return { type: 'text', text: line };
      });
  },

  // 在设置 detail 后调用此方法分割并解析
  updateDetailContent(detail) {
    if (!detail) return;
    const {
      detailText,
      suggestText
    } = this.splitCompContent(detail.content);
    // 【新增】按赛事 type 计算参赛模式：个人 / 团体 / 个人+团队（混合）
    const type = detail.type || ''
    const signMode = type === '个人' ? 'personal' : type === '团体' ? 'team' : 'mixed'
    this.setData({
      detail,
      signMode,
      detailLines: this.parseContentToLines(detailText),
      suggestLines: this.parseContentToLines(suggestText),
      // 报名中 / 未开始可发布队伍与匹配，已结束不可
      canOperate: detail.status !== '已结束'
    });
  },

  // 切割文本（适配仅输出【赛事简介】【赛事含金量】无备赛内容）
  splitCompContent(fullText) {
    if (!fullText) return {
      detailText: "",
      suggestText: ""
    };
    // 新分割关键词：赛事含金量
    const splitKey = "赛事含金量";
    const pos = fullText.indexOf(splitKey);
    if (pos === -1) {
      // 没找到含金量标题，全部归为简介，含金量为空
      return {
        detailText: fullText.trim(),
        suggestText: ""
      };
    }
    // 前半段：赛事简介；后半段：含金量完整内容（带上标题）
    const detailText = fullText.substring(0, pos).trim();
    const suggestText = fullText.substring(pos).trim();
    return {
      detailText,
      suggestText
    };
  },
  // 下拉刷新重新拉取数据
  async onPullDownRefresh() {
    await store.competition.loadCompetition()
    // loadCompetition 后 store 列表为数据库原始数据（回写的 posterUrl 已清空），
    // 该赛事仍有海报 fileID 时重新拉取临时链接，无海报则保持占位
    if (this.data.detail && this.data.detail.poster) {
      await this.getSinglePoster(this.data.cid)
    }
    wx.stopPullDownRefresh()
  }
})