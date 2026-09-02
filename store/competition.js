// 竞赛模块
const competition = {
  state: {
    list: []
  },

  // 拉取全部竞赛（通过 competitionApi）
  async loadCompetition() {
    const res = await wx.cloud.callFunction({
      name: 'competitionApi',
      data: {
        action: 'getAll'
      }
    })
    if (res.result.code === 0) {
      this.state.list = res.result.data
      // 通知订阅者（若有）
      if (typeof store !== 'undefined' && store.notify) {
        store.notify()
      }
    } else {
      console.error('加载竞赛失败', res.result)
    }
  },

  // 新增竞赛，增加 imageBase64 参数
  async addComp(compInfo, imageBase64 = '') {
    console.log(imageBase64.length);
    const res = await wx.cloud.callFunction({
      name: 'competitionApi',
      data: {
        action: 'create',
        params: {
          compInfo,
          imageBase64
        }
      }
    })
    if (res.result.code === 0) {
      await this.loadCompetition()
    }
    return res.result
  },

  // 修改竞赛，增加 imageBase64 参数
  // async updateComp(cid, newInfo, imageBase64 = '') {
  //   console.log("进入模块");
  //   console.log("【调试】imageBase64字符串长度：", imageBase64?.length || 0);
  //   const res = await wx.cloud.callFunction({
  //     name: 'competitionApi',
  //     data: {
  //       action: 'update',
  //       params: {
  //         cid,
  //         compInfo: newInfo,
  //         imageBase64
  //       }
  //     }
  //   })
  //   if (res.result.code === 0) {
  //     await this.loadCompetition()
  //   }
  //   return res.result
  // },
  async updateComp({
    cid,
    newInfo,
    imageBase64 = ''
  }) {
    console.log("【1】进入模块");
    try {
      const len = imageBase64.length;
      console.log("【2】base64长度：", len);
    } catch (e1) {
      console.error("读取长度报错：", e1);
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'competitionApi',
        data: {
          action: 'update',
          params: {
            cid,
            compInfo: newInfo,
            imageBase64
          }
        }
      })
      console.log("【3】云函数调用完成");
      if (res.result.code === 0) {
        console.log(res.result);
        await this.loadCompetition()
      }
      return res.result
    } catch (e2) {
      console.error("错误发生在云调用/loadCompetition：", e2);
    }
  },
  // 删除竞赛
  async deleteComp(cid) {
    const res = await wx.cloud.callFunction({
      name: 'competitionApi',
      data: {
        action: 'delete',
        params: {
          cid
        }
      }
    })
    if (res.result.code === 0) {
      await this.loadCompetition()
    }
    return res.result
  },

  // 仅本地临时覆盖缓存（页面筛选用，不同步云端）
  setList(newList) {
    this.state.list = newList
    if (typeof store !== 'undefined' && store.notify) {
      store.notify()
    }
  },

  getList() {
    return this.state.list
  },

  // 获取国A赛事海报的临时链接列表（异步）
  // 关键：临时链接本身带 sign（2小时左右过期），不能手动拼 ?t= 破坏签名。
  // 想要"强制刷新图片"应重新调 getTempFileURL 拿新 URL，而不是在 URL 上加参数。
  async getBanner() {
    // ===== 诊断日志 =====
    const allNational = this.state.list.filter(item => item.level === "国A")
    const withPoster = allNational.filter(item => item.poster)
    console.log('[getBanner] 赛事总数:', this.state.list.length,
      '| 国A数量:', allNational.length,
      '| 国A且有海报:', withPoster.length)

    const nationalEvents = withPoster.slice(0, 4)
    if (nationalEvents.length === 0) return []

    const cidList = nationalEvents.map(item => item.cid)
    const res = await wx.cloud.callFunction({
      name: 'competitionApi',
      data: {
        action: 'getFileTempUrl',
        params: { cidList, fieldType: 'image' }
      }
    })

    if (res.result.code === 0) {
      // 1. 建立 cid -> posterUrl 的快速映射
      const urlMap = {}
      res.result.data.forEach(item => {
        if (item.posterUrl) urlMap[item.cid] = item.posterUrl
      })
      console.log('[getBanner] urlMap:', urlMap)

      // 2. 把临时链接回写到全局列表的 item 中（直接用云端 URL，不追加任何参数）
      this.state.list.forEach(item => {
        if (urlMap[item.cid]) {
          item.posterUrl = urlMap[item.cid]
        }
      })

      // 3. 通知 store 更新视图
      if (typeof store !== 'undefined' && store.notify) {
        store.notify()
      }

      // 4. 返回数据：直接使用云端返回的 https 临时链接，不追加 ?t= 避免破坏签名
      const result = res.result.data
        .map(item => item.posterUrl)
        .filter(Boolean)
      console.log('[getBanner] 最终 bannerList:', result)
      return result
    } else {
      console.error('获取横幅临时链接失败（请检查 competitionApi 云函数是否已重新部署）', res.result)
      return []
    }
  },
  // 保留 setBanner 以防其他地方用到（但原逻辑已无需调用）
  setBanner(newBanner) {
    this.state.bannerList = newBanner
  },
  async aiGenerateDetail(cid, name, url) {
    console.log("进入store");
    const res = await wx.cloud.callFunction({
      name: 'competitionApi',
      data: {
        action: 'aiGenDetail',
        params: { cid, name, url }
      }
    })
    console.log("res:",res);
    if (res.result.code === 0) {
      // 生成完成后刷新本地竞赛列表缓存
      await this.loadCompetition()
    }
    return res.result
  }
}

module.exports = competition