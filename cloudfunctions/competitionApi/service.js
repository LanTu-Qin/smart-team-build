// service.js
const cloud = require('wx-server-sdk')
const mammoth = require('mammoth')
const axios = require('axios')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
  auth: 'ADMIN'
})
const db = cloud.database()
const ENV_PREFIX = '636c-cloud1-d8gb9nir3847ec081-1444113575' // 请根据实际环境修改

// ============================================================================
// compInfo 写入白名单（安全项，对齐 Web 管理端契约第 8 节第 8 条）
// ----------------------------------------------------------------------------
// 【历史问题】create / update 直接 `...compInfo` 整体透传写库，客户端可塞任意字段，
// 甚至覆盖 cid / poster / detailPoster / detailImageList / content 等关键字段。
// 管理端编辑页 form = 整条记录 item（`this.setData({ form: item })`），等于把整行
// 原样回写：一旦有人构造请求带 cid，就能把 A 赛事改成 B 的 cid，或直接篡改 content。
//
// 【修法】服务端按白名单**挑字段**，服务端独占字段一律不接收；写库顺序保证
// 服务端字段（cid / poster / …）永远覆盖客户端传值。
//
// 【为什么枚举不硬校验】C 端管理页的 type / status 是自由输入框（见 admin.wxml），
// level 取值里还有 "认定国B"，硬拒绝会打断现网小程序 —— 这里只做白名单 + 必填 +
// 长度 + 日期先后；枚举收紧建议先收敛 C 端表单为 picker 再上线。
// ============================================================================
const COMP_EDITABLE_FIELDS = [
  'name', 'url', 'level', 'type', 'status', 'start', 'end', 'organizer'
]
// 服务端独占字段：客户端传了也一律丢弃（只在日志里留痕，便于发现异常调用）
const COMP_SERVER_FIELDS = [
  'cid', 'content', 'poster', 'detailPoster', 'detailImageList', '_id', '_openid'
]
const COMP_MAX_LEN = {
  name: 40, url: 300, organizer: 30, level: 10, type: 10, status: 10, start: 20, end: 20
}

/** 参数错误：带 status=400，让 index.js 能区分"客户端传错"与"服务器崩了" */
function badRequest(message) {
  const err = new Error(message)
  err.status = 400
  return err
}

/** 白名单挑字段：trim 字符串、丢弃其余字段（含 cid / content / poster / …） */
function pickCompFields(compInfo = {}) {
  if (!compInfo || typeof compInfo !== 'object') throw badRequest('compInfo 格式不正确')
  const picked = {}
  COMP_EDITABLE_FIELDS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(compInfo, key)) return
    const val = compInfo[key]
    if (val === undefined) return
    picked[key] = typeof val === 'string' ? val.trim() : val
  })
  const smuggled = COMP_SERVER_FIELDS.filter((key) =>
    Object.prototype.hasOwnProperty.call(compInfo, key),
  )
  if (smuggled.length) console.warn('[competitionApi] 已丢弃非白名单字段：', smuggled.join(', '))
  return picked
}

/**
 * compInfo 校验
 * @param {object} data pickCompFields 的结果
 * @param {boolean} partial true=update（未传字段不校验），false=create（name 必填）
 */
function assertCompData(data, { partial = false } = {}) {
  if (!partial && !data.name) throw badRequest('请填写赛事名称')
  if (partial && 'name' in data && !data.name) throw badRequest('赛事名称不能为空')
  Object.keys(data).forEach((key) => {
    const max = COMP_MAX_LEN[key]
    if (max && String(data[key]).length > max) {
      throw badRequest(`${key} 超出长度限制（最多 ${max} 个字符）`)
    }
  })
  if (data.start && data.end && String(data.end) < String(data.start)) {
    throw badRequest('结束日期不能早于开始日期')
  }
  return data
}

// 修正讯飞MaaS接口地址 v1，http协议
// 密钥/模型已改为从云开发控制台环境变量读取（云函数→配置→环境变量），
// 需在控制台配置 AI_API_KEY 与 AI_MODEL_ID 后重新部署本函数；
// AI_API_KEY 不再保留本地明文兜底，未配置时请求会 401，便于及时发现。
const AI_API_KEY = process.env.AI_API_KEY || "";
const AI_URL = "https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions";
// 从服务卡片复制你的模型ID，必填（环境变量未配置时兜底默认模型）
const AI_MODEL_ID = process.env.AI_MODEL_ID || "xopdeepseekv32";
// lora_id 无微调模型固定填 "0"
const LORA_ID = "0";
const SYSTEM_PROMPT = `# 身份定位
你是高校竞赛信息整理专员，只输出客观真实赛事内容，严禁虚构主办方、赛程、组队、加分政策等信息，不确定内容统一标注【暂无权威官方信息，请以当年赛事官网最新通知为准】。

# 硬性真实约束
1. 不编造任何赛事规则、奖金、保研加分细则（如"保研加X分""奖金X万元"等具体数字），仅客观描述行业认可度；
2. 不生成路演、PPT、刷题、团队分工、计划书等所有备赛相关内容；
3. 只输出两大固定模块：赛事简介、赛事含金量，无额外板块；
4. 全文600字以内，行文正式，禁止Markdown符号、禁止星号加粗、禁止【】包裹标签名。

# 固定输出格式（必须严格逐行输出，9个标签名称不可更改、不可增删、不可合并）
赛事简介
主办/承办单位：内容
赛事定位：内容
举办宗旨：内容
参赛人群：内容
基础组队与赛制：内容

赛事含金量
高校综测/保研认可度：内容
企业招聘参考价值：内容
行业/学术层面作用：内容

# 强制要求
1. 两个模块标题行（赛事简介、赛事含金量）独占一行，后面直接换行写标签；
2. 每行标签必须使用全角冒号"："，格式为"标签名：内容"；
3. 内容基于真实公开信息，官网信息不足时不自行脑补，统一在对应行末尾标注【暂无权威官方信息，请以当年赛事官网最新通知为准】；
4. 内容客观中立，不夸大宣传。`;

class CompetitionService {
  constructor() {
    this.collection = db.collection('competition')
  }

  // ---------- 通用上传 ----------
  async uploadFile(cloudPath, base64) {
    if (!base64 || base64.trim() === '') return null
    const buffer = Buffer.from(base64, 'base64')
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: buffer
    })
    return uploadRes.fileID
  }

  // ---------- 查询全部 ----------
  async getAll() {
    const res = await this.collection.get()
    return res.data
  }

  // ---------- 分页查询（管理端列表：keyword 模糊匹配 name + status 筛选） ----------
  // 返回 { list, total, page, pageSize }，对齐 Web 管理端契约 GET /competitions
  async getPage(params = {}) {
    const page = Math.max(1, parseInt(params.page, 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize, 10) || 20))
    const kw = String(params.keyword || '').trim()
    const status = String(params.status || '').trim()

    const where = {}
    if (kw) {
      // 用户名/赛事名模糊：正则特殊字符转义，不区分大小写
      where.name = db.RegExp({ regexp: kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' })
    }
    if (status) where.status = status

    const countRes = await this.collection.where(where).count()
    const res = await this.collection.where(where)
      .orderBy('cid', 'asc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    return { list: res.data, total: countRes.total, page, pageSize }
  }

  // ---------- 按 cid 查单条赛事（管理端详情） ----------
  async getByCid(cid) {
    const res = await this.collection.where({ cid: Number(cid) }).get()
    return res.data[0] || null
  }

  // ---------- 创建（含图片上传） ----------
  async create(params) {
    console.log("创建中，imageBase64 长度:", params.imageBase64?.length || 0);
    const {
      compInfo,
      imageBase64
    } = params // 暂不处理 wordBase64

    // 1) 先算 cid，让 cloudPath 用 cid 而不是 name（避免 name 里的特殊字符 + " " 等导致路径问题）
    const maxRes = await this.collection.orderBy('cid', 'desc').limit(1).get()
    const cid = maxRes.data.length ? maxRes.data[0].cid + 1 : 1
    const imageCloudPath = `competition/comp_${cid}/image/poster.jpg`

    // 2) 上传图片，try-catch 避免 uploadFile 失败时把 poster 错置空
    let poster = ''
    if (imageBase64) {
      try {
        const res = await this.uploadFile(imageCloudPath, imageBase64)
        if (res) {
          poster = res
        } else {
          console.log('[create] uploadFile 返回空，poster 留空字符串')
        }
      } catch (e) {
        console.error('[create] uploadFile 失败, cloudPath:', imageCloudPath, 'err:', e.message)
      }
    }

    // 白名单挑字段 + 校验：compInfo 里混进来的 cid / content / poster 等一律不落库
    const data = assertCompData(pickCompFields(compInfo))

    const insertData = {
      ...data,
      cid, // 服务端自增主键，写在最后：客户端即便传了 cid 也覆盖不了
      poster, // 文件通道独占：只能由 uploadFile 产出的 fileID 写入
      content: '', // AI 简介：只能由 POST /competitions/:cid/ai-detail 写入
      detailPoster: '', // 预留 Word 字段
      detailImageList: []
    }
    await this.collection.add({
      data: insertData
    })
    return cid
  }

  // ---------- 更新（可更新图片） ----------
  async update(cid, params) {
    const {
      compInfo,
      imageBase64
    } = params
    // cid 只取路由/入参主体，compInfo 里的 cid 由 pickCompFields 丢弃，
    // 杜绝"改 A 却把 cid 改成 B，整行覆盖掉另一条赛事"
    const targetCid = Number(cid)
    if (!Number.isInteger(targetCid)) throw badRequest('cid 不合法，必须为数字')

    // partial=true：只更新实际传来的白名单字段；content / detailPoster / detailImageList 永不被本接口改写
    const updateData = assertCompData(pickCompFields(compInfo), { partial: true })
    // 改用 cid 作为目录，避免 name 含 + " 等特殊字符导致 cloudPath 非法
    const imageCloudPath = `competition/comp_${targetCid}/image/poster.jpg`
    console.log("更新中，cid:", targetCid, 'cloudPath:', imageCloudPath);
    if (imageBase64 && imageBase64.trim() !== '') {
      console.log("收到图片，长度:", imageBase64.length);
      // try-catch 保护：uploadFile 失败时不要把 poster 覆盖成空（保留原值）
      try {
        const newPoster = await this.uploadFile(imageCloudPath, imageBase64)
        if (newPoster) {
          updateData.poster = newPoster
          console.log('[update] 上传成功，新 fileID:', newPoster)
        } else {
          console.log('[update] uploadFile 返回空字符串，保留原 poster')
        }
      } catch (e) {
        console.error('[update] uploadFile 失败, cloudPath:', imageCloudPath, 'err:', e.message)
        // 失败时不更新 poster，保留数据库原值
      }
    } else {
      console.log("未提供新图片，保留原有 poster");
    }
    delete updateData._id
    await this.collection.where({
      cid: targetCid
    }).update({
      data: updateData
    })
    return true
  }

  // ---------- 删除 ----------
  async delete(cid) {
    console.log("删除中");
    const targetCid = Number(cid)
    if (!Number.isInteger(targetCid)) throw badRequest('cid 不合法，必须为数字')
    const info = await this.collection.where({
      cid: targetCid
    }).get()
    if (info.data.length) {
      const item = info.data[0]
      const delFiles = []
      if (item.poster) delFiles.push(item.poster)
      if (item.detailPoster) delFiles.push(item.detailPoster)
      if (Array.isArray(item.detailImageList)) delFiles.push(...item.detailImageList)
      if (delFiles.length) await cloud.deleteFile({
        fileList: delFiles
      })
    }
    await this.collection.where({
      cid: targetCid
    }).remove()
    return true
  }

  // ---------- 批量获取临时链接（仅图片） ----------
  async getFileTempUrl(cidList, fieldType = 'all') {
    console.log("getFileTempUrl 被调用，cidList:", cidList);
    if (!Array.isArray(cidList) || cidList.length === 0) return []
    const res = await this.collection.where({
      cid: db.command.in(cidList)
    }).get()
    const list = res.data
    const allFileIds = []
    const idMap = new Map()

    list.forEach(item => {
      const ids = []
      if (['image', 'all'].includes(fieldType) && item.poster) ids.push(item.poster)
      if (['wordImage', 'all'].includes(fieldType) && Array.isArray(item.detailImageList)) {
        ids.push(...item.detailImageList.filter(Boolean))
      }
      idMap.set(item.cid, {
        poster: item.poster,
        detailImageList: item.detailImageList || [],
        targetIds: ids
      })
      allFileIds.push(...ids)
    })

    let urlMap = {}
    if (allFileIds.length) {
      const tempRes = await cloud.getTempFileURL({
        fileList: allFileIds
      })
      console.log('[getFileTempUrl] 传入 fileIDs 数量:', allFileIds.length,
        '| 样例:', allFileIds.slice(0, 2))
      console.log('[getFileTempUrl] getTempFileURL 返回:', JSON.stringify(tempRes).slice(0, 1200))
      tempRes.fileList.forEach(file => {
        if (file.status === 0) urlMap[file.fileID] = file.tempFileURL
      })
      console.log('[getFileTempUrl] 转链成功数:', Object.keys(urlMap).length,
        '| 失败数:', tempRes.fileList.filter(f => f.status !== 0).length)
    } else {
      console.log('[getFileTempUrl] allFileIds 为空，前端传入的国A赛事可能都没有 poster 字段')
    }

    return list.map(item => {
      const cid = item.cid
      const mapItem = idMap.get(cid)
      const result = {
        cid
      }
      if (['image', 'all'].includes(fieldType)) {
        result.poster = mapItem.poster
        result.posterUrl = urlMap[mapItem.poster] || ''
      }
      if (['wordImage', 'all'].includes(fieldType)) {
        result.detailImageList = mapItem.detailImageList
        result.detailImageUrlList = mapItem.detailImageList.map(id => urlMap[id]).filter(Boolean)
      }
      return result
    })
  }

  // ---------- Word 转 HTML（暂不修改） ----------
  async wordToHtml(cid) {
    // ... 保留原实现（需要 mammoth 和 axios）
  }

  /**
   * AI生成赛事详情并更新数据库
   * @param {Number} cid 赛事ID
   * @param {String} name 赛事名称
   * @param {String} url 赛事官网
   * @returns {String} 生成后的content文本
   */
  async aiGenerateDetail(cid, name, url) {
    // 查询原赛事（契约：cid 必须为数字，统一 Number 化，避免 "1" 查不到 1）
    const targetCid = Number(cid)
    if (!Number.isInteger(targetCid)) throw badRequest('cid 不合法，必须为数字')
    console.log("【云端Debug】接收到 cid 类型:", typeof cid, "值为:", cid);
    const targetRes = await this.collection.where({
      cid: targetCid
    }).get()
    console.log(targetRes);
    if (!targetRes.data.length) {
      throw new Error("赛事不存在，cid:" + cid)
    }
    // AI生成文本
    const content = await this.#callAiModel(name, url)
    // 格式规整：清理Markdown残留、统一为固定9标签格式，防止模型输出走样
    const finalContent = this.#normalizeAiContent(content)
    // 更新数据库content字段
    await this.collection.where({
      cid: targetCid
    }).update({
      data: {
        content: finalContent
      }
    })
    return finalContent
  }

  /**
   * AI输出规整：去掉Markdown残留与序号前缀，统一成固定格式：
   * 赛事简介（标题）+ 5个标签行 / 赛事含金量（标题）+ 3个标签行，模块间空行分隔
   * @param {String} content AI 原始输出
   * @returns {String} 规整后的文本
   */
  #normalizeAiContent(content) {
    if (!content) return content
    const sectionTitles = ['赛事简介', '赛事含金量']
    const labelNames = [
      '主办/承办单位', '赛事定位', '举办宗旨', '参赛人群', '基础组队与赛制',
      '高校综测/保研认可度', '企业招聘参考价值', '行业/学术层面作用'
    ]
    const lines = content
      .split('\n')
      .map(l => {
        // 清理行首/行尾 Markdown 残留（** # - • 及数字序号），如 "**赛事简介**"、"*赛事含金量*"
        let s = l.replace(/^[\*\#]+\s*/, '').replace(/[\*\#]+$/, '').trim()
        s = s.replace(/^[\-\u2022]+\s*/, '').replace(/^\d+[\.、\)]\s*/, '')
        return s
      })
      .filter(l => l.length > 0)

    const clean = []
    lines.forEach(l => {
      if (sectionTitles.includes(l)) {
        clean.push({ type: 'title', text: l })
        return
      }
      // 识别标准标签行，如 "主办/承办单位：xxx"
      const matched = labelNames.find(n => l.indexOf(n) === 0 && l[n.length] === '：')
      if (matched) {
        clean.push({ type: 'label', text: l })
        return
      }
      clean.push({ type: 'text', text: l })
    })

    // 重组：标签行连续，模块标题前空行分隔（首个标题除外）
    const out = []
    clean.forEach(item => {
      if (item.type === 'title' && out.length > 0) {
        out.push('')
      }
      out.push(item.text)
    })
    return out.join('\n')
  }

  /**
   * 内部调用讯飞MaaS大模型（对齐官方OpenAI兼容示例）
   * @param {String} name 赛事名称
   * @param {String} url 赛事官网
   * @returns {String} 生成文案
   */
  async #callAiModel(name, url) {
    const userPrompt = `赛事名称：${name}\n赛事官方网站：${url || "无官网"}

请严格按以下格式输出，标签行固定为这 9 个，不可增删、不可合并，每行格式为"标签名：内容"：

赛事简介
主办/承办单位：xxx
赛事定位：xxx
举办宗旨：xxx
参赛人群：xxx
基础组队与赛制：xxx

赛事含金量
高校综测/保研认可度：xxx
企业招聘参考价值：xxx
行业/学术层面作用：xxx

要求：内容必须基于该赛事的真实公开信息（主办方、参赛对象、赛制等以官网/官方文件为准）；不确定的信息在对应行标注【暂无权威官方信息，请以当年赛事官网最新通知为准】；禁止编造具体奖项、奖金数字、保研加分细则等。`
    const messages = [{
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: userPrompt
      }
    ]

    try {
      const res = await axios.post(
        AI_URL, {
          model: AI_MODEL_ID, // 关键：替换为真实模型ID，不能写gpt-3.5-turbo
          messages: messages,
          stream: false, // 非流式生成
          temperature: 0.3,
          max_tokens: 1024,
          extra_headers: {
            lora_id: LORA_ID
          },
          stream_options: {
            include_usage: true
          }
        }, {
          headers: {
            Authorization: `Bearer ${AI_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 25000 
        }).catch(err=>{
          if(err.code === "ECONNABORTED"){
            throw new Error("大模型接口请求超时，请重试");
          }
          throw err;
        })

      // 校验返回结构
      if (!res.data?.choices?.length) {
        throw new Error("大模型返回数据为空，无生成内容");
      }
      return res.data.choices[0].message.content.trim()
    } catch (err) {
      // 细分错误提示，方便排查
      console.error("AI接口调用失败：", err.response?.status, err.response?.data || err.message)
      if (err.response?.status === 401) throw new Error("APIKey错误或权限不足");
      if (err.response?.status === 404) throw new Error("接口地址/模型ID错误");
      if (err.code === "ECONNABORTED") throw new Error("AI接口请求超时");
      throw new Error(`模型调用异常：${err.message}`)
    }
  }
}

module.exports = new CompetitionService()