/**
 * Browser half of dsh-english-dictation.
 *
 * A left-sidebar row opens one full central page. It always starts on the
 * Dashboard; 「开始练习」 opens the dictation page, which shows one sentence at a
 * time until the learner leaves. The system speaks the sentence, the learner
 * types it word by word, and the judgement, score, combo and rolling grade are
 * computed here with the same pure rules the Host enforces — so feedback lands
 * before any network call. The Host then reviews the sentence with the model and
 * selects the next one in parallel.
 *
 * The bundle is a lazy-CJS module: it registers a factory whose id equals the
 * package name. `require` may only name platform-baseline modules (`react`); the
 * bundle is otherwise self-contained.
 *
 * @see package.json `dsh.client`
 */

window.__ModuleLoader__.load({
	id: 'dsh-english-dictation',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')
		const h = React.createElement
		const { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore } = React

		/** This implementation's identity in the slot system; also the main-panel key. */
		const ID = 'dsh-english-dictation'
		/** Client locale namespace owned by this plugin. */
		const NS = 'dshEnglishDictation'
		/** Host route prefix; keep in sync with `API_PREFIX` in lib/rules.js. */
		const API = '/api/dsh-english-dictation'
		/** Running build stamp; the offline test keeps it in sync with package.json. */
		const VERSION = 'v0.48.1'
		/**
		 * How long the page waits for `POST /run/next` before it offers a retry.
		 *
		 * Deliberately longer than the Host's 30 s generation budget: a page that
		 * gives up first goes back to the Dashboard while the Host finishes the
		 * sentence a moment later — the learner then sees the loading screen turn
		 * into the Dashboard for no stated reason.
		 */
		const NEXT_WAIT_MS = 45000
		/** Normal playback rate. */
		const RATE_NORMAL = 0.95
		/** Footer playback speeds; the Host audio is rate-adjusted locally. */
		const PLAYBACK_RATES = [0.5, 0.8, 1, 1.5, 2]
		/** Slow playback rate. */
		const RATE_SLOW = 0.6
		/** Accent colours for the reveal card's word underlines. */
		const REVEAL_ACCENTS = [
			'var(--dsw-alias-state-success-primary, #16a34a)',
			'#7c3aed',
			'#0ea5e9',
			'#d97706',
		]
		/** Voice names to prefer, in order. */
		const PREFERRED_VOICES = ['Samantha', 'Ava', 'Microsoft Aria', 'Google US English', 'Karen', 'Moira', 'Tessa']
		/** Host voice slots (Aria/Guy via Edge); mirrored in lib/rules.js. */
		const CLOUD_VOICES = ['stella', 'tide']
		/** A one-sample silent WAV: spends the autoplay gesture without a sound. */
		const SILENT_WAV = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA=='
		/** Style element marker; one per document. */
		const STYLE_ATTR = 'data-dsh-english-dictation-style'

		/* ───────────────────────────── Locale ───────────────────────────── */

		const LOCALE_ZH = {
			'menu.label': '英文听写',
			'app.subtitle': '英文听写',
			'dash.level': '估算水平',
			'dash.streakLabel': '连续',
			'dash.days': '{n} 天',
			'dash.todayLabel': '今日',
			'dash.timeLabel': '时间',
			'dash.todayMinutes': '{minutes} 分钟',
			'dash.selfTitle': '先选一个起点',
			'dash.selfDesc': '这个选择只决定第一句的难度，之后会按你的表现自动调整。',
			'dash.band.A2': 'A2 入门',
			'dash.band.B1': 'B1 中级',
			'dash.band.B2': 'B2 中高级',
			'dash.band.C1': 'C1 高级',
			'dash.start': '开始练习',
			'dash.continue': '继续练习（第 {n} 句）',
			'dash.restart': '放弃，重新开始',
			'dash.confirmRestart': '放弃这次练习？已经练过的句子会记入档案。',
			'dash.confirmYes': '放弃',
			'dash.confirmNo': '取消',
			'dash.lastRun': '上次练习',
			'dash.accuracy': '准确率 {value}%',
			'dash.sentences': '{n} 句',
			'dash.issuesLine': '主要问题：{list}',
			'dash.weak': '弱项',
			'dash.archive': '查看档案',
			'dash.voice': '语音设置',
			'dash.hint': 'Enter 开始 / 继续 · Tab 切换控件',
			'dash.loading': '正在读取档案…',
			'practice.sentenceNo': '本次第 {n} 句',
			'practice.timeLabel': '本句用时',
			'practice.timerPaused': '计时已暂停',
			'practice.viewSource': '查看原文（新标签页）',
			'practice.score': '得分',
			'practice.combo': '连击 ×{n}',
			'practice.grade': '评级',
			'practice.typeHere': '听清后在这里输入',
			'practice.imeHint': '输入法正在组合文字：按空格 / 回车确认，或切到英文输入法',
			'practice.focusHint': '点一下输入框才能打字',
			'practice.shortcutPlay': '播放发音',
			'practice.shortcutSubmit': '检查',
			'practice.nextWord': '下一个词',
			'practice.shortcutReveal': '显示答案',
			'practice.pressEnter': '继续',
			'practice.correct': '正确',
			'practice.phraseStage': '组词 {n}/{total}',
			'practice.sentenceStage': '整句输入',
			'practice.scoredScreen': '这一屏计分',
			'practice.reveal': '看答案',
			'practice.listenFirst': 'please listen first',
			'practice.pressStart': 'press Enter to start, or press F11 to listen again',
			'practice.skip': 'Skip · next sentence',
			'practice.generatingShort': 'AI is writing…',
			'practice.skip': 'Skip · 换一句',
			'practice.generatingShort': 'AI 正在出题中…',
			'practice.revealTagChunk': '短语',
			'practice.revealTagSentence': '整句',
			'practice.revealCloseHint': '按 Enter / Esc 关闭，回到本题',
			'role.subject': '主语',
			'role.predicate': '谓语',
			'role.object': '宾语',
			'role.predicative': '表语',
			'role.attributive': '定语',
			'role.adverbial': '状语',
			'role.complement': '补语',
			'role.appositive': '同位语',
			'role.parenthetical': '插入语',
			'role.whole': '整句',
			'practice.revealHint': '本题 0 分、连击归零（Ctrl+;）',
			'practice.generating': '正在出下一句…',
			'practice.generatingTitle': 'AI 正在出题中…',
			'practice.generateFailed': '这句话没能生成出来，练习进度没有丢。',
			'practice.incompleteArticle': '这篇文章缺少中文翻译，重新生成一次就好。',
			'tags.subtitle': '选一个话题，开始练习。',
			'tags.start': '开始',
			'tags.continue': '继续',
			'tags.generating': '准备中…',
			'tags.words': '词',
			'tags.mastery': '掌握',
			'tags.voice': '语音',
			'tags.archive': '档案',
			'practice.runEnded': '这次练习已经结束了，回首页再开一次。',
			'home.subtitle': 'Agent工作的间隙，用英语短文练听写。',
			'home.addExercise': '添加练习',
			'home.more': '更多',
			'home.exercises': '练习({n})',
			'home.empty': '还没有练习，点右上角「添加练习」。',
			'home.statTime': '累计耗时',
			'home.statArticles': '听写文章',
			'home.statDictation': '平均得分',
			'home.unitScore': '分',
			'home.statVocabulary': '词汇覆盖',
			'home.statStreak': '连续坚持',
			'home.unitHour': 'h',
			'home.unitMinute': '分钟',
			'home.unitArticle': '篇',
			'home.unitWord': '个',
			'home.unitDay': '天',
			'home.notStarted': '未开始',
			'home.inProgress': '进行中',
			'home.completed': '已完成',
			'home.open': '继续这篇练习',
			'home.remove': '移除练习',
			'home.removed': '已移除，可在归档中重新生成',
			'home.removeFailed': '移除失败，请再试一次',
			'add.title': '添加文章到练习簿',
			'add.back': '返回',
			'add.refresh': '刷新文章列表',
			'add.wordsSuffix': '词',
			'add.ago.minutes': '{n} 分钟前',
			'add.ago.hours': '{n} 小时前',
			'add.ago.days': '{n} 天前',
			'cefr.A1.name': '入门',
			'cefr.A1.def': '能理解并使用日常熟悉的表达和最基本的句子；能自我介绍、问路、买东西。',
			'cefr.A2.name': '初级',
			'cefr.A2.def': '能就熟悉的日常话题做简单交流；能读懂短通知、菜单和个人信息。',
			'cefr.B1.name': '中级',
			'cefr.B1.def': '能应对旅行、学习和工作中的常见场景；能读懂日常短文并抓住主要意思。',
			'cefr.B2.name': '中高级',
			'cefr.B2.def': '能比较流利地和母语者交流；能读懂较长的文章和清楚的观点论述。',
			'cefr.C1.name': '高级',
			'cefr.C1.def': '能流利自然地表达；能读懂复杂的长文，并理解其中的隐含意思。',
			'cefr.C2.name': '精通',
			'cefr.C2.def': '能轻松理解几乎所有听到或读到的内容；能连贯地概括、复述信息，并在复杂场合精确表达细微含义。',
			'add.dialogTitle': '将文章生成听力练习',
			'add.levelSection': '选择等级',
			'add.toastAdded': '已加入练习簿：{title}（{level}）',
			'add.toastLabel': '听写提示',
			'add.openSource': '打开原文',
			'add.searchPlaceholder': '搜索文章标题，或粘贴文章链接…',
			'add.searchEmpty': '没有匹配的文章',
			'add.customFailed': '这个链接抓不到可用的文章，换一个试试。',
			'add.clear': '清除',
			'add.options': '选项',
			'add.optionsVoice': 'TTS 音色',
			'add.optionsRate': 'TTS 语速',
			'add.refreshAdded': '已更新 {n} 篇文章',
			'add.refreshNoChange': '所有源都已更新',
			'add.refreshFailed': '刷新失败，请再试一次',
			'add.dialogHint': '会按你选的等级重写原文，再拆成 6–20 句听写句。',
			'add.hostModel': '采用 {model} 生成',
			'add.hostModelFallback': '使用宿主的 LLM 生成',
			'add.hostModelHint': '跟随当前会话的模型，不需要额外配置 API Key',
			'add.cancel': '取消',
			'add.generate': '生成 {level} 短文',
			'add.chooseLevel': '选择等级并添加',
			'add.addedAt': '已在练习簿（{level}）',
			'topic.all': '全部',
			'topic.science': '科学',
			'topic.environment': '环境',
			'topic.technology': '科技',
			'topic.health': '健康',
			'topic.society': '社会',
			'topic.psychology': '心理',
			'topic.other': '其他',
			'add.sourcesOk': '{n} 个源',
			'add.sourcesPartial': '{n} 个源暂不可用',
			'add.loadingMore': '加载更多',
			'add.empty': '暂时没有可添加的文章，稍后刷新看看。',
			'add.emptyTopic': '这个话题暂时没有文章，换一个看看。',
			'add.loading': '正在读取文章…',
			'add.adding': '正在改写成 {level} 短文…',
			'add.failed': '这篇文章没能加进来，请再试一次。',
			'add.failedLevel': '没能改成 {level} 短文，可以再试一次。',
			'add.noText': '这篇抓不到正文，换一篇试试。',
			'articles.title': '文章练习',
			'coach.open': '问AI',
			'coach.disabled': '听写中不可用',
			'coach.title': '问AI',
			'coach.close': '关闭',
			'coach.empty': '关于这篇文章，你可以问我',
			'coach.placeholder': '问一个语法/用法问题…',
			'coach.send': '发送',
			'coach.voice': '语音',
			'coach.stopVoice': '停止',
			'coach.transcribing': '识别中…',
			'coach.voiceDenied': '无法使用麦克风，请检查权限。',
			'coach.voiceFailed': '语音识别失败，请重试。',
			'coach.voiceUnavailable': '语音识别未启用：请在 Plugins 启用 Voice Input。',
			'coach.voiceEmpty': '没有识别到语音。',
			'coach.thinking': '正在想…',
			'coach.failed': '暂时无法回答，请再试一次。',
			'coach.suggestSentence1': '这句话的主干是什么？',
			'coach.suggestSentence2': '为什么用这个时态？',
			'coach.suggestSentence3': '这个词在这里什么意思？',
			'coach.suggestArticle1': '这篇文章主要讲了什么？',
			'coach.suggestArticle2': '这篇为什么主要用过去时？',
			'coach.suggestArticle3': '帮我挑 3 个值得记的搭配。',
			'articles.generating': '正在拆句翻译…',
			'articles.back': '返回',
			'sentence.tryAgain': '再试一次',
			'sentence.replay': '重听 / 暂停（Alt / Option）',
			'sentence.listenPrompt': '先听语音，敲击回车或空格写下句子',
			'sentence.listenFooter': '先听语音，点击回车或空格后用英文写下句子',
			'sentence.replayCommand': '重听 / 暂停（Alt / Option）',
			'sentence.speed': '播放速度（点击切换）',
			'sentence.hint': '听一句，写一句 · 回车检查',
			'practice.writeHint': '写下你听到的句子 · 按 ↑ 看当前词（记一次错），Alt 重听/暂停',
			'practice.resultHint': '按 Enter 或空格继续',
			'summary.retry': '重新练习',
			'score.composite': '听写综合分',
			'score.spelling': '拼写准确度',
			'score.heading': '听写得分',
			'score.help': '听写得分 = 拼写准确度 × 听辨流畅度',
			'score.fluency': '听辨流畅度',
			'summary.completed': '你完成 {n} 句练习',
			'summary.elapsed': '耗时 {minutes} 分 {seconds} 秒',
			'sentence.wordAria': '第 {n} 个词',
			'sentence.peekTag': '整句',
			'sentence.peekHint': '松开 Option / Alt 关闭',
			'practice.retryGenerate': '再试一次',
			'practice.firstGenerating': '正在生成第一句…',
			'practice.back': '返回 Dashboard',
			'feedback.great': 'Great',
			'feedback.pass': '过关',
			'feedback.reveal': '看答案',
			'feedback.perfectCombo': 'Perfect ×{n}',
			'feedback.seconds': '{seconds} 秒',
			'feedback.bonus': '×{value}',
			'feedback.unscored': '本题不计分',
			'feedback.aiReview': 'AI 复盘',
			'feedback.wordReport': '单词练习报告',
			'feedback.reviewing': 'AI 复盘生成中…',
			'feedback.reviewFailed': '这次没生成复盘',
			'feedback.retryReview': '重试',
			'feedback.replayWord': '重听这个单词',
			'feedback.replaySentence': '重听整句',
			'feedback.continue': '继续',
			'feedback.continueHint': '继续 ⏎',
			'archive.title': '学习档案',
			'archive.empty': '还没有练习记录。',
			'archive.removed': '已移除的练习',
			'archive.noRemoved': '还没有移除的练习。',
			'archive.regenerate': '重新生成',
			'archive.regenerating': '生成中…',
			'archive.regenerated': '已重新生成练习',
			'archive.regenerateFailed': '重新生成失败，请再试一次',
			'archive.noSource': '没有原文链接，无法重新生成',
			'archive.stats': '{runs} 次练习 · {sentences} 句 · {minutes} 分钟',
			'archive.tags': '错误类型掌握度',
			'archive.noTags': '还没有错误标签数据。',
			'archive.back': '返回',
			'voice.title': '语音设置',
			'voice.noVoice': '系统未找到英文语音，请在「系统设置 → 辅助功能 → 朗读内容」中安装英文语音。',
			'voice.engine': '发音来源',
			'voice.engineCloud': 'Edge 语音（在线）',
			'voice.engineSystem': '系统语音',
			'voice.cloudVoice': '音色',
			'voice.cloudStella': 'Aria（女声，美音）',
			'voice.cloudTide': 'Guy（男声，美音）',
			'voice.cloudReady': 'Edge-TTS 已就绪 · 在线合成，无需 Key',
			'voice.cloudMissing': 'Edge-TTS 不可用，已回退本地 say / 系统语音',
			'voice.rateCloud': '语速',
			'voice.redetect': '重新检测',
			'voice.select': '系统音色',
			'voice.rate': '语速',
			'voice.preview': '试听',
			'voice.close': '关闭',
			'voice.confirm': '确认',
			'voice.unavailable': '没有可用的语音',
			'error.network': '连不上本地服务，请稍后重试。',
			'error.generic': '出了点问题，请重试。',
			'common.retry': '重试',
			'tag.spelling': '拼写',
			'tag.articles': '冠词',
			'tag.tense': '时态',
			'tag.agreement': '主谓一致',
			'tag.preposition': '介词',
			'tag.word_order': '语序',
			'tag.word_form': '词形',
			'tag.collocation': '搭配',
			'tag.missing_word': '漏词',
			'tag.punctuation': '标点大小写',
			'pos.pron': '代词',
			'pos.verb': '动词',
			'pos.noun': '名词',
			'pos.adj': '形容词',
			'pos.adv': '副词',
			'pos.prep': '介词',
			'pos.conj': '连词',
			'pos.det': '限定词',
			'pos.num': '数词',
			'pos.interj': '感叹词',
			'pos.other': '其他',
		}

		const LOCALE_EN = {
			'menu.label': 'English Dictation',
			'app.subtitle': 'English Dictation',
			'dash.level': 'Estimated level',
			'dash.streakLabel': 'Streak',
			'dash.days': '{n} days',
			'dash.todayLabel': 'Today',
			'dash.timeLabel': 'Time',
			'dash.todayMinutes': '{minutes} min',
			'dash.selfTitle': 'Pick a starting point',
			'dash.selfDesc': 'It only sets the difficulty of the first sentence; the rest adapts to you.',
			'dash.band.A2': 'A2 Beginner',
			'dash.band.B1': 'B1 Intermediate',
			'dash.band.B2': 'B2 Upper',
			'dash.band.C1': 'C1 Advanced',
			'dash.start': 'Start practicing',
			'dash.continue': 'Resume (sentence {n})',
			'dash.restart': 'Abandon and start over',
			'dash.confirmRestart': 'Abandon this run? Sentences you already did are kept in the archive.',
			'dash.confirmYes': 'Abandon',
			'dash.confirmNo': 'Cancel',
			'dash.lastRun': 'Last run',
			'dash.accuracy': '{value}% accuracy',
			'dash.sentences': '{n} sentences',
			'dash.issuesLine': 'Main issues: {list}',
			'dash.weak': 'Weak spots',
			'dash.archive': 'Archive',
			'dash.voice': 'Voice',
			'dash.hint': 'Enter to start / continue · Tab to move',
			'dash.loading': 'Loading your profile…',
			'practice.sentenceNo': 'sentence {n} this run',
			'practice.timeLabel': 'Time on this sentence',
			'practice.timerPaused': 'Timer paused',
			'practice.viewSource': 'View the original article (new tab)',
			'practice.score': 'Score',
			'practice.combo': 'Combo ×{n}',
			'practice.grade': 'Grade',
			'practice.typeHere': 'Type what you hear',
			'practice.imeHint': 'Your input method is composing — press space or enter to commit, or switch to English',
			'practice.focusHint': 'Click the field to type',
			'practice.shortcutPlay': 'Play pronunciation',
			'practice.shortcutSubmit': 'Check',
			'practice.nextWord': 'next word',
			'practice.shortcutReveal': 'Show answer',
			'practice.pressEnter': 'to continue',
			'practice.correct': 'Correct',
			'practice.phraseStage': 'Phrases {n}/{total}',
			'practice.sentenceStage': 'Whole sentence',
			'practice.scoredScreen': 'this screen is scored',
			'practice.reveal': 'Reveal',
			'practice.listenFirst': 'please listen first',
			'practice.pressStart': 'press Enter to start, or press F11 to listen again',
			'practice.skip': 'Skip · next sentence',
			'practice.generatingShort': 'AI is writing…',
			'practice.skip': 'Skip · 换一句',
			'practice.generatingShort': 'AI 正在出题中…',
			'practice.revealTagChunk': 'Phrase',
			'practice.revealTagSentence': 'Whole sentence',
			'practice.revealCloseHint': 'Enter / Esc closes — you stay on this question',
			'role.subject': 'Subject',
			'role.predicate': 'Predicate',
			'role.object': 'Object',
			'role.predicative': 'Predicative',
			'role.attributive': 'Attributive',
			'role.adverbial': 'Adverbial',
			'role.complement': 'Complement',
			'role.appositive': 'Appositive',
			'role.parenthetical': 'Parenthetical',
			'role.whole': 'Whole sentence',
			'practice.revealHint': 'No score for this one, combo resets (Ctrl+;)',
			'practice.generating': 'Writing the next sentence…',
			'practice.generatingTitle': 'AI is writing the sentence…',
			'practice.generateFailed': 'The sentence did not arrive. Your run is untouched.',
			'practice.incompleteArticle': 'This article is missing its Chinese translations — generate it again.',
			'tags.subtitle': 'Pick a topic and start practicing.',
			'tags.start': 'Start',
			'tags.continue': 'Continue',
			'tags.generating': 'Preparing…',
			'tags.words': 'words',
			'tags.mastery': 'mastery',
			'tags.voice': 'Voice',
			'tags.archive': 'Archive',
			'practice.runEnded': 'This run has already ended — start a new one from the home page.',
			'home.subtitle': 'Practice English dictation with short texts between the agent\'s tasks.',
			'home.addExercise': 'Add an exercise',
			'home.more': 'More',
			'home.exercises': 'Exercises({n})',
			'home.empty': 'No exercises yet — add one from the top right.',
			'home.statTime': 'Total time',
			'home.statArticles': 'Articles',
			'home.statDictation': 'Average score',
			'home.unitScore': 'pts',
			'home.statVocabulary': 'Vocabulary',
			'home.statStreak': 'Streak',
			'home.unitHour': 'h',
			'home.unitMinute': 'min',
			'home.unitArticle': 'articles',
			'home.unitWord': 'words',
			'home.unitDay': 'days',
			'home.notStarted': 'Not started',
			'home.inProgress': 'In progress',
			'home.completed': 'Completed',
			'home.open': 'Open this exercise',
			'home.remove': 'Remove exercise',
			'home.removed': 'Removed — regenerate it from the archive',
			'home.removeFailed': 'Could not remove the exercise. Try again.',
			'add.title': 'Add articles to practice',
			'add.back': 'Back',
			'add.refresh': 'Refresh the article list',
			'add.wordsSuffix': 'words',
			'add.ago.minutes': '{n}m ago',
			'add.ago.hours': '{n}h ago',
			'add.ago.days': '{n}d ago',
			'cefr.A1.name': 'Beginner',
			'cefr.A1.def': 'Can understand and use familiar everyday expressions; can introduce yourself and ask simple questions.',
			'cefr.A2.name': 'Elementary',
			'cefr.A2.def': 'Can handle simple, routine exchanges on familiar topics; can read short notices, menus and personal messages.',
			'cefr.B1.name': 'Intermediate',
			'cefr.B1.def': 'Can deal with most situations while travelling, studying or working; can read everyday texts and follow the main points.',
			'cefr.B2.name': 'Upper intermediate',
			'cefr.B2.def': 'Can interact with reasonable fluency; can read longer articles and follow clear argumentation.',
			'cefr.C1.name': 'Advanced',
			'cefr.C1.def': 'Can express ideas fluently and spontaneously; can read complex, long texts and understand implicit meaning.',
			'cefr.C2.name': 'Mastery',
			'cefr.C2.def': 'Can understand with ease virtually everything heard or read; can summarise and reconstruct arguments, and express fine shades of meaning in complex situations.',
			'add.dialogTitle': 'Turn this article into a listening exercise',
			'add.levelSection': 'Choose your level',
			'add.toastAdded': 'Added: {title} ({level})',
			'add.toastLabel': 'Dictation notice',
			'add.openSource': 'Open the original article',
			'add.searchPlaceholder': 'Search titles, or paste an article URL…',
			'add.searchEmpty': 'No matching articles',
			'add.customFailed': 'Could not read an article from this link.',
			'add.clear': 'Clear',
			'add.options': 'Options',
			'add.optionsVoice': 'TTS voice',
			'add.optionsRate': 'TTS rate',
			'add.refreshAdded': 'Updated {n} articles',
			'add.refreshNoChange': 'All sources are up to date',
			'add.refreshFailed': 'Refresh failed. Try again.',
			'add.dialogHint': 'The article will be rewritten at the level you choose, then split into 6–20 dictation sentences.',
			'add.hostModel': 'Generated with {model}',
			'add.hostModelFallback': "Generated with the host's LLM",
			'add.hostModelHint': "Uses this session's model; no extra API key is needed",
			'add.cancel': 'Cancel',
			'add.generate': 'Generate {level}',
			'add.chooseLevel': 'Choose a level and add',
			'add.addedAt': 'Already in the book ({level})',
			'topic.all': 'All',
			'topic.science': 'Science',
			'topic.environment': 'Environment',
			'topic.technology': 'Technology',
			'topic.health': 'Health',
			'topic.society': 'Society',
			'topic.psychology': 'Psychology',
			'topic.other': 'Other',
			'add.sourcesOk': '{n} sources',
			'add.sourcesPartial': '{n} unavailable',
			'add.loadingMore': 'loading more',
			'add.empty': 'No articles to add right now. Try refreshing later.',
			'add.emptyTopic': 'Nothing in this topic right now — try another.',
			'add.loading': 'Loading articles…',
			'add.adding': 'Rewriting at {level}…',
			'add.failed': 'This article could not be added. Try again.',
			'add.failedLevel': 'Could not rewrite this at {level}. Try again.',
			'add.noText': 'No article text could be fetched. Try another one.',
			'articles.title': 'Article practice',
			'coach.open': 'Ask AI',
			'coach.disabled': 'Not available while writing',
			'coach.title': 'Ask AI',
			'coach.close': 'Close',
			'coach.empty': 'Ask me about this article',
			'coach.placeholder': 'Ask a grammar or usage question…',
			'coach.send': 'Send',
			'coach.voice': 'Voice',
			'coach.stopVoice': 'Stop',
			'coach.transcribing': 'Transcribing…',
			'coach.voiceDenied': 'Microphone unavailable. Check permission.',
			'coach.voiceFailed': 'Speech recognition failed. Try again.',
			'coach.voiceUnavailable': 'Speech recognition is not enabled. Enable Voice Input in Plugins.',
			'coach.voiceEmpty': 'No speech was recognized.',
			'coach.thinking': 'Thinking…',
			'coach.failed': 'Could not answer just now. Try again.',
			'coach.suggestSentence1': 'What is the main clause of this sentence?',
			'coach.suggestSentence2': 'Why is this tense used here?',
			'coach.suggestSentence3': 'What does this word mean here?',
			'coach.suggestArticle1': 'What is this article about?',
			'coach.suggestArticle2': 'Why does this article mostly use the past tense?',
			'coach.suggestArticle3': 'Pick three collocations worth remembering.',
			'articles.generating': 'Splitting and translating…',
			'articles.back': 'Back',
			'sentence.tryAgain': 'Try again',
			'sentence.replay': 'Replay / pause (Alt / Option)',
			'sentence.listenPrompt': 'Listen first — press Enter or Space to write the sentence',
			'sentence.listenFooter': 'Listen first — press Enter or Space to write it in English',
			'sentence.replayCommand': 'Replay / pause (Alt / Option)',
			'sentence.speed': 'Playback speed (click to change)',
			'sentence.hint': 'Listen, then type · Enter to check',
			'practice.writeHint': 'Write what you hear · press ↑ to peek at this word (counts as one miss), Alt to replay/pause',
			'practice.resultHint': 'Press Enter or Space to continue',
			'summary.retry': 'Retry again',
			'score.composite': 'Dictation score',
			'score.spelling': 'Spelling accuracy',
			'score.heading': 'Dictation score',
			'score.help': 'Dictation score = spelling accuracy × listening fluency',
			'score.fluency': 'Listening fluency',
			'summary.completed': 'You completed {n} sentences',
			'summary.elapsed': 'Took {minutes}m {seconds}s',
			'sentence.wordAria': 'word {n}',
			'sentence.peekTag': 'Sentence',
			'sentence.peekHint': 'Release Option / Alt to close',
			'practice.retryGenerate': 'Try again',
			'practice.firstGenerating': 'Writing the first sentence…',
			'practice.back': 'Back to dashboard',
			'feedback.great': 'Great',
			'feedback.pass': 'Passed',
			'feedback.reveal': 'Revealed',
			'feedback.perfectCombo': 'Perfect ×{n}',
			'feedback.seconds': '{seconds}s',
			'feedback.bonus': '×{value}',
			'feedback.unscored': 'No score for this one',
			'feedback.aiReview': 'AI review',
			'feedback.wordReport': 'Word report',
			'feedback.reviewing': 'Writing the review…',
			'feedback.reviewFailed': 'No review this time',
			'feedback.retryReview': 'Retry',
			'feedback.replayWord': 'Replay this word',
			'feedback.replaySentence': 'Replay the sentence',
			'feedback.continue': 'Continue',
			'feedback.continueHint': 'Continue ⏎',
			'archive.title': 'Archive',
			'archive.empty': 'No practice yet.',
			'archive.removed': 'Removed exercises',
			'archive.noRemoved': 'No removed exercises yet.',
			'archive.regenerate': 'Regenerate',
			'archive.regenerating': 'Generating…',
			'archive.regenerated': 'Exercise regenerated',
			'archive.regenerateFailed': 'Could not regenerate. Try again.',
			'archive.noSource': 'No article link to regenerate from',
			'archive.stats': '{runs} runs · {sentences} sentences · {minutes} min',
			'archive.tags': 'Error-tag mastery',
			'archive.noTags': 'No error-tag data yet.',
			'archive.back': 'Back',
			'voice.title': 'Voice',
			'voice.noVoice': 'No English voice was found. Install one under System Settings → Accessibility → Spoken Content.',
			'voice.engine': 'Voice source',
			'voice.engineCloud': 'Edge voice (online)',
			'voice.engineSystem': 'System voice',
			'voice.cloudVoice': 'Timbre',
			'voice.cloudStella': 'Aria (female, US)',
			'voice.cloudTide': 'Guy (male, US)',
			'voice.cloudReady': 'Edge-TTS ready · online, no key',
			'voice.cloudMissing': 'Edge-TTS unavailable — falling back to local say / system voice',
			'voice.rateCloud': 'Rate',
			'voice.redetect': 'Detect again',
			'voice.select': 'System voice',
			'voice.rate': 'Rate',
			'voice.preview': 'Preview',
			'voice.close': 'Close',
			'voice.confirm': 'Done',
			'voice.unavailable': 'No voice available',
			'error.network': 'The local service is unreachable. Try again.',
			'error.generic': 'Something went wrong. Try again.',
			'common.retry': 'Retry',
			'tag.spelling': 'Spelling',
			'tag.articles': 'Articles',
			'tag.tense': 'Tense',
			'tag.agreement': 'Agreement',
			'tag.preposition': 'Preposition',
			'tag.word_order': 'Word order',
			'tag.word_form': 'Word form',
			'tag.collocation': 'Collocation',
			'tag.missing_word': 'Missing word',
			'tag.punctuation': 'Punctuation & case',
			'pos.pron': 'pronoun',
			'pos.verb': 'verb',
			'pos.noun': 'noun',
			'pos.adj': 'adjective',
			'pos.adv': 'adverb',
			'pos.prep': 'preposition',
			'pos.conj': 'conjunction',
			'pos.det': 'determiner',
			'pos.num': 'numeral',
			'pos.interj': 'interjection',
			'pos.other': 'other',
		}

		/** Bound locale lookup; replaced by `ctx.locale.bind(NS)` in apply. */
		let translate = (key) => {
			const dict = LOCALE_ZH
			return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
		}

		/**
		 * Fill `{name}` placeholders in a localized template.
		 * @param {string} template - template.
		 * @param {object} [vars] - values.
		 * @returns {string} text.
		 */
		function fill(template, vars) {
			if (!vars) return String(template)
			return String(template).replace(/\{(\w+)\}/g, (match, name) =>
				Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
			)
		}

		/**
		 * A locale-bound translator for a component.
		 * @param {object} props - slot props, may carry `t`.
		 * @returns {(key: string, vars?: object) => string} translator.
		 */
		function useTranslator(props) {
			const source = props && typeof props.t === 'function' ? props.t : translate
			return useCallback((key, vars) => fill(source(key), vars), [source])
		}

		/* ───────────────────────────── Rules (mirror) ─────────────────────────────
		 * These functions mirror lib/rules.js. The browser cannot import an ESM
		 * module from inside a lazy-CJS factory, and scoring must be local, so the
		 * copy is deliberate; `test/run.mjs` cross-checks both implementations on a
		 * matrix of cases so they cannot silently drift.
		 * ----------------------------------------------------------------------- */

		const BASE_SCORE = { perfect: 100, great: 70, pass: 40, reveal: 0 }
		const ROLLING_WINDOW = 10

		function clamp(value, min, max) {
			const number = Number.isFinite(value) ? value : min
			if (number < min) return min
			if (number > max) return max
			return number
		}

		function normalizeWord(text) {
			return String(text ?? '')
				.replace(/[’‘]/g, "'")
				.toLowerCase()
				.replace(/[^a-z'-]/g, '')
		}

		/** Words that are names, companies, places or languages even when they start a sentence. */
		const PROPER_WORDS = new Set([
			'mary', 'john', 'james', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas',
			'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'mark', 'donald', 'steven', 'paul',
			'andrew', 'joshua', 'kenneth', 'kevin', 'brian', 'george', 'edward', 'ronald', 'timothy', 'jason',
			'jeffrey', 'ryan', 'jacob', 'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin',
			'scott', 'brandon', 'benjamin', 'samuel', 'gregory', 'alexander', 'frank', 'patrick', 'raymond',
			'jack', 'dennis', 'jerry', 'tyler', 'aaron', 'jose', 'adam', 'nathan', 'henry', 'zachary',
			'douglas', 'peter', 'kyle', 'noah', 'ethan', 'jeremy', 'walter', 'christian', 'keith', 'roger',
			'terry', 'gerald', 'harold', 'sean', 'austin', 'carl', 'arthur', 'lawrence', 'dylan', 'jesse',
			'jordan', 'bryan', 'billy', 'bruce', 'gabriel', 'logan', 'albert', 'willie', 'alan', 'juan',
			'wayne', 'elijah', 'randy', 'roy', 'vincent', 'ralph', 'eugene', 'russell', 'bobby', 'mason',
			'philip', 'louis', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan', 'jessica',
			'sarah', 'karen', 'lisa', 'nancy', 'betty', 'margaret', 'sandra', 'ashley', 'kimberly', 'emily',
			'donna', 'michelle', 'carol', 'amanda', 'dorothy', 'melissa', 'deborah', 'stephanie', 'rebecca',
			'sharon', 'laura', 'cynthia', 'kathleen', 'amy', 'angela', 'shirley', 'anna', 'brenda', 'pamela',
			'emma', 'nicole', 'helen', 'samantha', 'katherine', 'christine', 'debra', 'rachel', 'carolyn',
			'janet', 'catherine', 'maria', 'heather', 'diane', 'ruth', 'julie', 'olivia', 'joyce', 'virginia',
			'victoria', 'kelly', 'lauren', 'christina', 'joan', 'evelyn', 'judith', 'megan', 'cheryl',
			'andrea', 'hannah', 'martha', 'jacqueline', 'frances', 'gloria', 'ann', 'teresa', 'kathryn',
			'sara', 'janice', 'jean', 'alice', 'madison', 'doris', 'abigail', 'julia', 'judy', 'grace',
			'denise', 'amber', 'marilyn', 'beverly', 'danielle', 'theresa', 'sophia', 'marie', 'diana',
			'brittany', 'natalie', 'isabella', 'charlotte', 'rose', 'alexis', 'kayla',
			'youtube', 'google', 'facebook', 'microsoft', 'apple', 'amazon', 'twitter', 'instagram', 'tiktok',
			'netflix', 'whatsapp', 'linkedin', 'snapchat', 'reddit', 'yahoo', 'baidu', 'alibaba', 'tencent',
			'huawei', 'samsung', 'sony', 'nike', 'adidas', 'pepsi', 'starbucks', 'ikea', 'toyota', 'honda',
			'ford', 'tesla', 'bmw', 'mercedes', 'audi', 'volkswagen',
			'uk', 'us', 'usa', 'united', 'kingdom', 'america', 'britain', 'british', 'england', 'english',
			'london', 'paris', 'france', 'french', 'germany', 'german', 'berlin', 'spain', 'spanish', 'madrid',
			'italy', 'italian', 'rome', 'china', 'chinese', 'beijing', 'shanghai', 'japan', 'japanese',
			'tokyo', 'korea', 'korean', 'seoul', 'india', 'indian', 'delhi', 'canada', 'canadian',
			'australia', 'australian', 'mexico', 'mexican', 'brazil', 'brazilian', 'russia', 'russian',
			'moscow', 'europe', 'european', 'africa', 'african', 'asia', 'asian',
			'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january',
			'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
			'november', 'december',
		])

		/** Capitalized words that are ordinary grammar, not names. */
		const NOT_PROPER = new Set([
			'i', "i'm", "i'll", "i've", "i'd", 'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my',
			'your', 'his', 'her', 'its', 'our', 'their', 'some', 'any', 'no', 'not', 'and', 'or', 'but',
			'so', 'if', 'when', 'while', 'because', 'although', 'though', 'as', 'than', 'then', 'there',
			'here', 'it', 'they', 'we', 'you', 'he', 'she', 'people', 'someone', 'everyone', 'nobody',
			'also', 'however', 'yes', 'okay', 'ok', 'one', 'many', 'most', 'all', 'both', 'each', 'every',
			'after', 'before', 'during', 'in', 'on', 'at', 'for', 'from', 'with', 'without', 'by', 'to',
			'of', 'into', 'about', 'over', 'under', 'between', 'through', 'around',
		])

		/**
		 * Proper-looking words that still belong to the dictation: languages,
		 * nationalities, weekdays, months and common abbreviations. “English” is
		 * vocabulary, not a name; only people/company/place names and titles are
		 * given to the learner.
		 */
		const NEVER_GIVEN = new Set([
			'english', 'chinese', 'spanish', 'french', 'german', 'italian', 'japanese', 'korean',
			'portuguese', 'russian', 'arabic', 'hindi', 'dutch', 'greek', 'latin', 'british',
			'american', 'canadian', 'australian', 'indian', 'mexican', 'brazilian', 'european',
			'african', 'asian', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
			'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
			'september', 'october', 'november', 'december', 'tv', 'tvs', 'pdf', 'dvd', 'cd', 'ok',
			'sms', 'gps', 'atm', 'ceo', 'hr', 'id', 'ai', 'internet',
		])

		/** Lowercase connectors inside a title such as “Videos in Levels”. */
		const TITLE_CONNECTORS = new Set(['of', 'in', 'the', 'de', 'van', 'von', 'for', 'at'])

		/**
		 * Mark the proper nouns the learner should not have to type. The model's
		 * explicit list is authoritative when present; this heuristic covers old
		 * articles and any name the model forgot.
		 * @param {Array<object>} units - sentence units.
		 * @returns {void}
		 */
		function markProperNouns(units) {
			for (let index = 0; index < units.length; index += 1) {
				const unit = units[index]
				const display = String(unit.display || '')
				if (!/^[A-Z]/u.test(display)) continue
				const plain = String(unit.plain || '')
				if (plain === 'i' || plain.startsWith("i'")) continue
				if (NEVER_GIVEN.has(plain)) continue
				const allCaps = /^[A-Z]{2,6}$/u.test(display)
				const internal = /[A-Z]/u.test(display.slice(1))
				const known = PROPER_WORDS.has(plain)
				if (index > 0 && !NOT_PROPER.has(plain)) unit.given = true
				else if (known || allCaps || internal) unit.given = true
			}
			// “Videos in Levels”, “New York”, “John Smith”: two or more capitalized
			// words (optionally joined by a lowercase title connector) are one name.
			for (let index = 0; index < units.length; index += 1) {
				const unit = units[index]
				if (!/^[A-Z]/u.test(String(unit.display || ''))) continue
				if (NOT_PROPER.has(String(unit.plain || ''))) continue
				if (NEVER_GIVEN.has(String(unit.plain || ''))) continue
				const sequence = [index]
				// A known person name followed by “in London” is a sentence phrase, not
				// a title; only allow the lowercase connector for unknown first words
				// such as “Videos in Levels”.
				const allowConnectors = !PROPER_WORDS.has(String(unit.plain || ''))
				let at = index
				while (at + 1 < units.length) {
					const next = units[at + 1]
					if (/^[A-Z]/u.test(String(next.display || '')) && !NOT_PROPER.has(String(next.plain || '')) && !NEVER_GIVEN.has(String(next.plain || ''))) {
						sequence.push(at + 1)
						at += 1
						continue
					}
					const after = units[at + 2]
					if (
						allowConnectors &&
						TITLE_CONNECTORS.has(String(next.plain || '')) &&
						after &&
						/^[A-Z]/u.test(String(after.display || '')) &&
						!NOT_PROPER.has(String(after.plain || '')) &&
						!NEVER_GIVEN.has(String(after.plain || ''))
					) {
						sequence.push(at + 1, at + 2)
						at += 2
						continue
					}
					break
				}
				if (sequence.length >= 2) for (const spot of sequence) units[spot].given = true
			}
		}

		/**
		 * Mark the model's explicit proper-noun phrases (single words or “Videos in
		 * Levels”), matching consecutive units case/punctuation-insensitively.
		 * @param {Array<object>} units - sentence units.
		 * @param {string[]|string} given - phrases from the model.
		 * @returns {void}
		 */
		function markGivenPhrases(units, given) {
			const phrases = Array.isArray(given) ? given : [given]
			const plains = units.map((unit) => unit.plain)
			for (const phrase of phrases) {
				const tokens = String(phrase ?? '')
					.split(/\s+/)
					.map((word) => normalizeWord(word))
					.filter(Boolean)
				if (tokens.length === 0) continue
				if (tokens.length === 1 && NEVER_GIVEN.has(tokens[0])) continue
				for (let start = 0; start + tokens.length <= plains.length; start += 1) {
					if (!tokens.every((token, offset) => plains[start + offset] === token)) continue
					for (let offset = 0; offset < tokens.length; offset += 1) units[start + offset].given = true
				}
			}
		}

		/**
		 * One article sentence broken into per-word units: letters/apostrophes inside a
		 * box, surrounding punctuation printed beside it. Words flagged `given` (names,
		 * companies, places) are displayed like punctuation and never typed.
		 * @param {string} sentence - English sentence.
		 * @param {string[]} [given] - explicit proper nouns from the model.
		 * @returns {Array<{raw: string, display: string, plain: string, prefix: string, suffix: string, given: boolean}>} units.
		 */
		function sentenceUnits(sentence, given) {
			const units = String(sentence ?? '')
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.map((raw) => {
					const match = /^([^A-Za-z'’-]*)([A-Za-z'’\-]+)([^A-Za-z'’-]*)$/.exec(raw)
					if (match) {
						const display = match[2]
						return {
							raw,
							display,
							plain: normalizeWord(display),
							prefix: match[1],
							suffix: match[3],
							given: false,
						}
					}
					// Arabic numerals are printed, not typed, just like a name. A token with
					// no letters but digits becomes a given unit; mixed forms such as “B2”
					// keep the letters in the box and the digit in the printed suffix.
					if (/[0-9]/.test(raw)) {
						return {
							raw,
							display: raw,
							plain: raw.replace(/[^0-9]/g, ''),
							prefix: '',
							suffix: '',
							given: true,
						}
					}
					return null
				})
				.filter((unit) => unit !== null && (unit.plain !== '' || unit.given))
			markProperNouns(units)
			if (given !== undefined && given !== null) markGivenPhrases(units, given)
			return units
		}

		/**
		 * News in Levels puts the level in the RSS title ("… – level 2").
		 * @param {string} title - article title.
		 * @returns {number} level 1–3, 1 when absent.
		 */
		function articleLevelOf(title) {
			const match = /level\s*([0-9]+)/i.exec(String(title ?? ''))
			const level = match ? Number(match[1]) : 1
			return Number.isFinite(level) && level >= 1 && level <= 3 ? level : 1
		}

		/**
		 * Whether a pasted string is an absolute http(s) URL.
		 * @param {string} value - user input.
		 * @returns {boolean} true for a usable link.
		 */
		function isHttpUrl(value) {
			const text = String(value ?? '').trim()
			if (!/^https?:\/\//i.test(text) || /\s/.test(text)) return false
			return text.length > 8
		}

		/**
		 * The host shown under the article title, without a leading `www.`.
		 * @param {string} url - article URL.
		 * @returns {string} domain, or '' when the URL is unusable.
		 */
		function domainOf(url) {
			const match = /^(?:https?:\/\/)?([^/?#]+)/i.exec(String(url ?? '').trim())
			if (!match) return ''
			return match[1].replace(/^www\./i, '').toLowerCase()
		}

		/**
		 * The title as a person reads it: the graded suffix is stripped because
		 * the L1/L2/L3 badge already carries the level, and "Are squishy toys
		 * safe? – level 1" next to an L1 chip says it twice.
		 * @param {string} title - feed title.
		 * @returns {string} display title.
		 */
		function displayTitle(title) {
			return String(title ?? '')
				.replace(/\s*[–—-]\s*level\s*[0-9]+\s*$/i, '')
				.trim()
		}

		/**
		 * The level to print on an exercise: the CEFR stored with the unit, or
		 * the old L1/L2/L3 mapped onto it for exercises generated before levels
		 * became CEFR.
		 * @param {object} entry - saved exercise row.
		 * @returns {string} one of CEFR_LEVELS.
		 */
		function exerciseCefr(entry) {
			if (entry && CEFR_LEVELS.includes(entry.cefr)) return entry.cefr
			const legacy = articleLevelOf(entry && entry.title)
			return legacy === 1 ? 'A2' : legacy === 2 ? 'B1' : 'B2'
		}

		/**
		 * Badge colour band: A1/A2 violet, B1/B2 green, C1 amber.
		 * @param {string} level - CEFR id.
		 * @returns {'A'|'B'|'C'} band.
		 */
		function cefrBand(level) {
			const band = String(level || 'B1').charAt(0)
			return band === 'A' ? 'A' : band === 'C' ? 'C' : 'B'
		}

		/**
		 * How old an article is, in the largest unit that still reads as a
		 * number ("5d ago"). An unparsable date is an empty string, never "NaN".
		 * @param {string} publishedAt - RSS pubDate.
		 * @param {(key: string, vars?: object) => string} t - translator.
		 * @returns {string} age label.
		 */
		function ageText(publishedAt, t) {
			const at = Date.parse(String(publishedAt || ''))
			if (!Number.isFinite(at)) return ''
			const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000))
			if (minutes < 60) return t('add.ago.minutes', { n: minutes })
			const hours = Math.floor(minutes / 60)
			if (hours < 24) return t('add.ago.hours', { n: hours })
			return t('add.ago.days', { n: Math.floor(hours / 24) })
		}

		/**
		 * The home's five counters.
		 *
		 * The Host's exercise-book summary is the source; the fallbacks keep a
		 * page that predates the summary (or a stubbed reply) from showing
		 * "NaN" where a number belongs.
		 * @param {object} data - dashboard payload.
		 * @param {Array<object>} savedArticles - exercise book.
		 * @param {object|null} summary - Host summary, may be absent.
		 * @returns {{elapsedMs: number, articles: number, accuracy: number, vocabulary: number, streak: number}} counters.
		 */
		function homeStats(data, savedArticles, summary) {
			const list = Array.isArray(savedArticles) ? savedArticles : []
			const totals = data && data.totals && typeof data.totals === 'object' ? data.totals : {}
			const source = summary && typeof summary === 'object' ? summary : null
			const elapsedMs = source
				? Math.max(0, Number(source.elapsedMs) || 0)
				: list.reduce((sum, entry) => sum + Math.max(0, Number(entry && entry.elapsedMs) || 0), 0) +
					Math.max(0, Number(totals.minutes) || 0) * 60000
			const articles = source
				? Math.max(0, Number(source.started) || 0)
				: list.filter((entry) => entry && entry.started === true).length
			const runs = data && Array.isArray(data.runs) ? data.runs : []
			let sentences = 0
			let weighted = 0
			for (const run of runs) {
				const count = Math.max(0, Number(run && run.sentences) || 0)
				sentences += count
				weighted += count * clamp(Number(run && run.accuracy) || 0, 0, 100)
			}
			const accuracy = source
				? clamp(Number(source.accuracy) || 0, 0, 100)
				: sentences === 0
					? 0
					: Math.round(weighted / sentences)
			const derivedListening = []
			for (const entry of list) {
				if (!entry || entry.phase !== 'done' || !entry.score) continue
				const comprehension = Number(entry.score.comprehension)
				const factor = Number(entry.score.listenFactor)
				if (Number.isFinite(comprehension)) derivedListening.push(clamp(comprehension, 0, 100))
				else if (Number.isFinite(factor)) derivedListening.push(clamp(factor, 0, 1) * 100)
			}
			const listening =
				source && Number.isFinite(Number(source.listening))
					? clamp(Number(source.listening), 0, 100)
					: derivedListening.length === 0
						? 0
						: Math.round(derivedListening.reduce((sum, value) => sum + value, 0) / derivedListening.length)
			const derivedDictation = []
			for (const entry of list) {
				if (!entry || entry.phase !== 'done' || !entry.score) continue
				const value = Number(entry.score.value)
				if (Number.isFinite(value)) derivedDictation.push(clamp(value, 0, 100))
			}
			const dictation =
				source && Number.isFinite(Number(source.dictation))
					? clamp(Number(source.dictation), 0, 100)
					: derivedDictation.length === 0
						? 0
						: Math.round(derivedDictation.reduce((sum, value) => sum + value, 0) / derivedDictation.length)
			return {
				elapsedMs,
				articles,
				accuracy,
				listening,
				dictation,
				vocabulary: source ? Math.max(0, Number(source.vocabulary) || 0) : 0,
				streak: Math.max(0, Number(data && data.streak) || 0),
			}
		}

		/**
		 * Split elapsed milliseconds into the value and unit a stat card prints
		 * ("8.1" + "h" after an hour, "26" + "min" before it).
		 * @param {number} elapsedMs - practiced time.
		 * @returns {{value: string, unitKey: string}} parts.
		 */
		function timeStatOf(elapsedMs) {
			const minutes = Math.floor(Math.max(0, Number(elapsedMs) || 0) / 60000)
			if (minutes >= 60) return { value: (minutes / 60).toFixed(1), unitKey: 'home.unitHour' }
			return { value: String(minutes), unitKey: 'home.unitMinute' }
		}

		/**
		 * The key that leaves the result screen and starts the next sentence. There is
		 * no input to carry the keystroke, so the result installs one listener and
		 * accepts exactly Enter and Space.
		 * @param {{key?: string}} event - key event.
		 * @returns {'next'|null} action.
		 */
		function sentenceResultAction(event) {
			const key = event && typeof event === 'object' ? event.key : ''
			if (key === 'Enter' || key === ' ' || key === 'Spacebar') return 'next'
			return null
		}

		/**
		 * Alt/Option replays the current sentence, or pauses/resumes speech.
		 * @param {{key?: string, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean}} event - key event.
		 * @returns {boolean} true when the event is the replay shortcut.
		 */
		function isReplayShortcut(event) {
			if (!event || typeof event !== 'object') return false
			if (event.ctrlKey || event.metaKey || event.shiftKey) return false
			return String(event.key) === 'Alt'
		}

		/**
		 * Arrow navigation between word boxes: Left at the very start jumps to the
		 * previous word's end, Right at the very end jumps to the next word's start.
		 * A selection, modifier, or IME composition keeps the native caret move.
		 * @param {object} facts - key, caret positions and modifiers.
		 * @param {number} length - current input length.
		 * @param {boolean} hasPrevious - an earlier editable word exists.
		 * @param {boolean} hasNext - a later editable word exists.
		 * @returns {'previous'|'next'|null} jump direction.
		 */
		function arrowDestination(facts, length, hasPrevious, hasNext) {
			if (!facts || typeof facts !== 'object') return null
			if (facts.shiftKey || facts.metaKey || facts.ctrlKey || facts.altKey || facts.isComposing) return null
			const start = Number(facts.selectionStart)
			const end = Number(facts.selectionEnd)
			if (!Number.isFinite(start) || !Number.isFinite(end) || start !== end) return null
			const key = String(facts.key || '')
			if ((key === 'ArrowLeft' || key === 'Left') && start === 0 && hasPrevious) return 'previous'
			if ((key === 'ArrowRight' || key === 'Right') && start === Math.max(0, Number(length) || 0) && hasNext) return 'next'
			return null
		}

		/**
		 * Whether a keydown is a plain letter that should make the typing click.
		 * Modifiers, repeats, IME composition and every non-letter key stay silent.
		 * @param {object} event - key event.
		 * @returns {boolean} true for a single letter key.
		 */
		function typingLetter(event) {
			if (!event || typeof event !== 'object') return false
			if (event.metaKey || event.ctrlKey || event.altKey) return false
			if (event.isComposing || event.repeat) return false
			const key = String(event.key || '')
			return key.length === 1 && /^[a-z]$/iu.test(key)
		}

		function normalizeSentence(text) {
			return String(text ?? '')
				.replace(/[’‘]/g, "'")
				.toLowerCase()
				.split(/\s+/)
				.filter((word) => word !== '')
				.map((word) => word.replace(/[^a-z'-]/g, ''))
				.join(' ')
				.trim()
		}

		function punctuationOf(text) {
			return String(text ?? '').replace(/[A-Za-z'’-]/g, '')
		}

		function resultOf(flags) {
			const source = flags || {}
			if (source.revealed) return 'reveal'
			if (source.hadError) return 'pass'
			if (source.usedBackspace) return 'great'
			return 'perfect'
		}

		function multiplier(combo) {
			const n = Math.max(0, Math.floor(Number(combo) || 0))
			if (n < 3) return 1
			if (n < 5) return 1.1
			if (n < 7) return 1.2
			if (n < 10) return 1.3
			if (n < 15) return 1.5
			if (n < 20) return 1.8
			return 2
		}

		function sentenceScore(result, comboBefore) {
			const base = Object.prototype.hasOwnProperty.call(BASE_SCORE, result) ? BASE_SCORE[result] : 0
			return Math.round(base * multiplier(comboBefore))
		}

		function nextCombo(combo, result) {
			if (result === 'perfect' || result === 'great') return Math.max(0, Math.floor(Number(combo) || 0)) + 1
			return 0
		}

		function outcomeOf(result) {
			if (result === 'perfect' || result === 'great') return 1
			if (result === 'pass') return 0.5
			return 0
		}

		function rateOf(result) {
			const base = Object.prototype.hasOwnProperty.call(BASE_SCORE, result) ? BASE_SCORE[result] : 0
			return base / 100
		}

		function gradeOfRate(rate) {
			if (rate >= 0.95) return 'SSS'
			if (rate >= 0.9) return 'SS'
			if (rate >= 0.85) return 'S'
			if (rate >= 0.75) return 'A'
			if (rate >= 0.6) return 'B'
			return 'C'
		}

		function rollingGrade(results, window = ROLLING_WINDOW) {
			const list = Array.isArray(results) ? results : []
			const size = Number.isFinite(window) && window > 0 ? Math.floor(window) : ROLLING_WINDOW
			const recent = list.slice(-size)
			const rates = recent.map((entry) => rateOf(typeof entry === 'string' ? entry : entry && entry.result))
			const rate = rates.length === 0 ? 0 : rates.reduce((sum, value) => sum + value, 0) / rates.length
			return { grade: gradeOfRate(rate), rate, sample: rates.length, low: rates.length < size }
		}

		/* ───────────────────────────── Typed input ───────────────────────────── */

		/* ───────────────────────── Sentence constituents ───────────────────────── */

		/** The sentence roles a question can carry. */
		const ROLES = ['subject', 'predicate', 'object', 'predicative', 'attributive', 'adverbial', 'complement', 'appositive', 'parenthetical']

		/** Chinese role words the model may answer with, mapped to the canonical keys. */
		const ROLE_ALIASES = {
			subject: ['subject', '主语'],
			predicate: ['predicate', '谓语'],
			object: ['object', '宾语'],
			predicative: ['predicative', '表语'],
			attributive: ['attributive', '定语'],
			adverbial: ['adverbial', '状语'],
			complement: ['complement', '补语'],
			appositive: ['appositive', '同位语'],
			parenthetical: ['parenthetical', '插入语'],
		}

		/** Normalize a role word (English key or Chinese term) to a canonical key. */
		function roleOf(text) {
			const value = String(text ?? '').trim().toLowerCase()
			for (const key of ROLES) {
				if (ROLE_ALIASES[key].some((alias) => alias.toLowerCase() === value)) return key
			}
			return ''
		}

		/** Auxiliaries, modals and negations that form the predicate. */
		const AUX_WORDS = new Set([
			'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
			'has', 'have', 'had', 'do', 'does', 'did',
			'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
			"don't", "doesn't", "didn't", "can't", "won't", "isn't", "aren't", "wasn't",
			"weren't", "hasn't", "haven't", "hadn't", "couldn't", "shouldn't", "wouldn't", "mustn't",
		])
		const COPULAS = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being'])
		const PREPOSITIONS = new Set([
			'in', 'on', 'at', 'for', 'from', 'with', 'of', 'by', 'about', 'under', 'over',
			'into', 'through', 'during', 'after', 'before', 'near', 'between', 'without', 'around',
			'behind', 'across', 'along', 'toward', 'towards', 'against', 'upon', 'within', 'off',
			'up', 'down', 'out', 'inside', 'outside', 'beside', 'beneath', 'among', 'per',
		])
		const DETERMINERS = new Set([
			'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its',
			'our', 'their', 'some', 'any', 'each', 'every', 'no', 'another', 'much', 'many',
			'two', 'three', 'four', 'five', 'both', 'all',
		])
		const CONJUNCTIONS = new Set(['and', 'or', 'but', 'so', 'if', 'when', 'while', 'because', 'than', 'though', 'although', 'unless', 'until', 'since'])
		const NEGATIONS = new Set(['not', "n't", 'never'])
		const INTERJECTIONS = new Set(['no', 'yes', 'oh', 'ah', 'well', 'hi', 'hello', 'wow', 'hey'])

		/**
		 * Split a sentence into sentence constituents (句子成分), the way the reference
		 * app does: each constituent becomes one practice question, every word inside it
		 * stays its own input box.
		 *
		 * Heuristic order: a leading interjection is an adverbial; the words before the
		 * first verb form the subject; auxiliary/verb/negation words form the predicate;
		 * prepositional phrases are adverbials; what follows a copula is a predicative
		 * and what follows a transitive verb is an object; anything else is an adverbial.
		 *
		 * For "No, I am not the teacher." this yields
		 * `No,` (状语) / `I` (主语) / `am not` (谓语) / `the teacher` (表语).
		 *
		 * @param {Array<string|{text?: string, raw?: string, plain?: string, pos?: string}>} words - words.
		 * @returns {{chunks: number[][], roles: string[]}} constituent groups and roles.
		 */
		function parseChunks(words) {
			const list = (Array.isArray(words) ? words : []).map((word) => {
				if (typeof word === 'string') return { text: word, pos: '' }
				if (word && typeof word === 'object') {
					return { text: String(word.text ?? word.raw ?? word.plain ?? ''), pos: typeof word.pos === 'string' ? word.pos : '' }
				}
				return { text: '', pos: '' }
			})
			const count = list.length
			const bare = (index) => normalizeWord(list[index] ? list[index].text : '')
			const posOf = (index) => {
				const pos = list[index] ? list[index].pos : ''
				return pos === 'other' ? '' : pos
			}
			const isAux = (index) => AUX_WORDS.has(bare(index))
			const isNeg = (index) => NEGATIONS.has(bare(index))
			const isVerb = (index) => posOf(index) === 'verb' || isAux(index) || isNeg(index)
			const isPrep = (index) => posOf(index) === 'prep' || PREPOSITIONS.has(bare(index))
			const isDet = (index) => posOf(index) === 'det' || DETERMINERS.has(bare(index))
			const isNameish = (index) => posOf(index) === 'noun' || posOf(index) === 'pron' || posOf(index) === 'num'
			const chunks = []
			const roles = []
			const push = (indexes, role) => {
				if (indexes.length === 0) return
				chunks.push(indexes)
				roles.push(role)
			}
			let index = 0

			// Leading interjection: 状语 ("No,").
			if (index < count && (posOf(index) === 'interj' || INTERJECTIONS.has(bare(index)))) {
				push([index], 'adverbial')
				index += 1
			}

			// Subject: everything before the first verb-like word.
			if (index < count) {
				const group = []
				while (index < count && !isVerb(index) && !isPrep(index) && group.length < 5) {
					if (isDet(index) || isNameish(index) || posOf(index) === 'adj' || posOf(index) === '') {
						group.push(index)
						index += 1
						continue
					}
					break
				}
				if (group.length > 0) push(group, 'subject')
			}

			// Predicate: auxiliary / modal / negation + verb chain (up to 4).
			let predicateCopula = false
			if (index < count && (isAux(index) || isNeg(index) || posOf(index) === 'verb')) {
				const group = []
				while (index < count && group.length < 4 && (isAux(index) || isNeg(index) || posOf(index) === 'verb' || posOf(index) === '')) {
					if (posOf(index) === '' && group.length > 0 && (isPrep(index) || CONJUNCTIONS.has(bare(index)))) break
					group.push(index)
					index += 1
				}
				predicateCopula = group.some((wordIndex) => COPULAS.has(bare(wordIndex)))
				push(group, 'predicate')
			}

			// The rest: prepositional phrases are adverbials; copula complements are
			// predicatives; noun groups after a verb are objects; leftovers are adverbials.
			while (index < count) {
				if (isPrep(index)) {
					if (bare(index) === 'to' && index + 1 < count && (posOf(index + 1) === 'verb' || posOf(index + 1) === '')) {
						const previousVerb = index > 0 && (isVerb(index - 1) || (isAux(index - 1) && COPULAS.has(bare(index - 1))))
						push([index, index + 1], previousVerb ? 'object' : 'adverbial')
						index += 2
						continue
					}
					const group = [index]
					let cursor = index + 1
					while (cursor < count && group.length < 4 && (isDet(cursor) || isNameish(cursor) || posOf(cursor) === 'adj' || (posOf(cursor) === '' && !isPrep(cursor) && !CONJUNCTIONS.has(bare(cursor))))) {
						group.push(cursor)
						cursor += 1
						if (isNameish(cursor - 1)) break
					}
					push(group, 'adverbial')
					index = cursor
					continue
				}
				const group = [index]
				let cursor = index + 1
				while (cursor < count && group.length < 4 && (isDet(cursor) || isNameish(cursor) || posOf(cursor) === 'adj') && !isVerb(cursor) && !isPrep(cursor)) {
					group.push(cursor)
					cursor += 1
					if (isNameish(cursor - 1)) break
				}
				const verbBefore = index > 0 && (isVerb(index - 1) || (isAux(index - 1) && COPULAS.has(bare(index - 1))))
				const role = predicateCopula ? 'predicative' : verbBefore ? 'object' : 'adverbial'
				push(group, role)
				index = cursor
			}
			if (chunks.length === 0) {
				chunks.push(list.map((_, wordIndex) => wordIndex))
				roles.push('predicate')
			}
			return { chunks, roles }
		}

		/**
		 * Validate a model's constituent parse.
		 *
		 * The parse must cover every word once, in order, in 1–5 word groups, and carry
		 * one known role per group.
		 *
		 * @param {unknown} rawChunks - candidate groups.
		 * @param {unknown} rawRoles - candidate roles.
		 * @param {number} count - word count.
		 * @returns {{chunks: number[][], roles: string[]}|null} parse, or null.
		 */
		function validateParse(rawChunks, rawRoles, count) {
			const total = Math.max(0, Math.floor(Number(count) || 0))
			if (!Array.isArray(rawChunks) || !Array.isArray(rawRoles) || rawChunks.length !== rawRoles.length) return null
			if (total === 0 || rawChunks.length === 0 || rawChunks.length > total) return null
			if (total > 3 && rawChunks.length < 2) return null
			const chunks = []
			const roles = []
			const seen = new Set()
			let expected = 0
			for (let groupIndex = 0; groupIndex < rawChunks.length; groupIndex += 1) {
				const group = rawChunks[groupIndex]
				if (!Array.isArray(group) || group.length === 0 || group.length > 5) return null
				const list = []
				for (const value of group) {
					if (!Number.isInteger(value) || value < 0 || value >= total || seen.has(value)) return null
					if (value !== expected) return null
					seen.add(value)
					expected += 1
					list.push(value)
				}
				const role = roleOf(rawRoles[groupIndex])
				if (role === '') return null
				chunks.push(list)
				roles.push(role)
			}
			return expected === total ? { chunks, roles } : null
		}


		/**
		 * Chunks and roles for an item: the model's parse when valid, else the rule.
		 * @param {unknown} rawChunks - model groups.
		 * @param {unknown} rawRoles - model roles.
		 * @param {Array<string|{text: string}>} words - words.
		 * @returns {{chunks: number[][], roles: string[]}} plan.
		 */
		function planOf(rawChunks, rawRoles, words) {
			const list = Array.isArray(words) ? words : []
			return validateParse(rawChunks, rawRoles, list.length) || parseChunks(list)
		}





		/**
		 * The constituent plan of an item: the model's parse when it is valid, else
		 * the grammar rule.
		 * @param {object} item - sentence item.
		 * @param {object[]} words - prepared words.
		 * @returns {{chunks: number[][], roles: string[]}} plan.
		 */
		function planOf(item, words) {
			const list = Array.isArray(words) ? words : []
			const rawChunks = item && Array.isArray(item.chunks) ? item.chunks : null
			const rawRoles = item && Array.isArray(item.roles) ? item.roles : null
			return validateParse(rawChunks, rawRoles, list.length) || parseChunks(list)
		}

		/**
		 * The chunks this item is typed in (kept for callers that only need them).
		 * @param {object} item - sentence item.
		 * @param {object[]} words - prepared words.
		 * @returns {number[][]} groups of word indexes.
		 */
		function wordChunksOf(item, words) {
			return planOf(item, words).chunks
		}
		/**
		 * The screens one sentence is practiced in: one screen per phrase, then one
		 * screen for the whole sentence.
		 * @param {number[][]} chunks - phrase groups of word indexes.
		 * @param {number} count - word count.
		 * @returns {Array<{kind: 'chunk'|'sentence', indexes: number[]}>} steps.
		 */
		function buildSteps(chunks, count) {
			const total = Math.max(0, Math.floor(Number(count) || 0))
			const groups = Array.isArray(chunks) ? chunks.filter((group) => Array.isArray(group) && group.length > 0) : []
			// A teacher keeps short phrases together ("the teacher") and teaches the
			// longer constituents word by word.
			const steps = []
			for (const group of groups) {
				if (group.length <= 2) steps.push({ kind: 'chunk', indexes: group.slice() })
				else for (const index of group) steps.push({ kind: 'chunk', indexes: [index] })
			}
			steps.push({ kind: 'sentence', indexes: Array.from({ length: total }, (_, index) => index) })
			return steps
		}

		/**
		 * Whether what was typed is this screen's answer.
		 *
		 * Checked only on submit: spaces are optional, case is ignored, and both
		 * apostrophe widths compare equal, so a learner is never blocked by spacing.
		 * @param {string} typed - typed value.
		 * @param {string} target - expected text.
		 * @returns {boolean} true when it matches.
		 */
		function matchesTarget(typed, target) {
			const clean = (text) =>
				String(text ?? '')
					.replace(/[’‘]/g, "'")
					.replace(/\s+/g, '')
					.toLowerCase()
			const value = clean(typed)
			return value !== '' && value === clean(target)
		}

		/**
		 * Which word boxes of a question are wrong.
		 * @param {string[]} answers - what each box holds.
		 * @param {string[]} targets - the expected word in each box.
		 * @returns {boolean[]} one flag per box.
		 */
		function wrongWordFlags(answers, targets) {
			const list = Array.isArray(targets) ? targets : []
			return list.map((target, index) => {
				const answer = answers && typeof answers === 'object' ? answers[index] : ''
				return normalizeWord(answer) !== normalizeWord(target)
			})
		}

		/**
		 * How the underlines are drawn for a screen: one per word, as long as the
		 * word's letters, plus the total width of the field (letters and the spaces
		 * between words).
		 * @param {string[]} plainWords - the screen's words, punctuation stripped.
		 * @returns {{counts: number[], total: number}} underline widths in `ch`.
		 */
		function underlineLayout(plainWords) {
			const list = Array.isArray(plainWords) ? plainWords : []
			const counts = list.map((word) => Math.max(1, String(word ?? '').length))
			const letters = counts.reduce((sum, count) => sum + count, 0)
			const spaces = Math.max(0, counts.length - 1)
			return { counts, total: Math.max(4, letters + spaces) }
		}

		/**
		 * Whether `word` is just a regular inflection of `base` (looking/look,
		 * walks/walk, studied/study). Regular forms must not be printed in the
		 * Chinese hint; irregular ones (is/be, went/go) may.
		 * @param {string} word - the target word (plain).
		 * @param {string} base - the dictionary form.
		 * @returns {boolean} true when the form is mechanical.
		 */
		function isRegularInflection(word, base) {
			const target = String(word ?? '')
			const stem = String(base ?? '')
			if (target === '' || stem === '' || target === stem) return true
			const suffixes = ['s', 'es', 'ed', 'd', 'ing', 'er', 'est', 'ly', 'ies', 'ied', 'ying', 'ies']
			for (const suffix of suffixes) if (target === stem + suffix) return true
			const last = stem.slice(-1)
			const doubled = stem.length >= 2 && last === stem.slice(-2, -1) ? '' : last
			if (doubled !== '' && (target === stem + doubled + 'ed' || target === stem + doubled + 'ing' || target === stem + doubled + 'er' || target === stem + doubled + 'est')) return true
			const yStem = stem.endsWith('y') ? stem.slice(0, -1) : stem
			if (target === `${yStem}ies` || target === `${yStem}ied`) return true
			if (stem.endsWith('e') && (target === `${stem.slice(0, -1)}ing` || target === `${stem.slice(0, -1)}ed`)) return true
			return false
		}

		/**
		 * The key that moves on from a result display. Only `Enter` and `Tab`; nothing
		 * else is intercepted there because a result has no field to type into.
		 * @param {{key?: string}} event - key event.
		 * @returns {'next'|null} action.
		 */
		function cardKeyAction(event) {
			if (!event) return null
			const key = String(event.key ?? '')
			if (key === 'Enter' || key === 'Tab') return 'next'
			return null
		}

		/**
		 * Which shortcut a key event asks for — only modifier combinations, never a
		 * bare letter.
		 * @param {{key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean}} event - key event.
		 * @returns {'play'|'reveal'|null} action.
		 */
		function shortcutOf(event) {
			if (!event || (!event.ctrlKey && !event.metaKey)) return null
			if (event.altKey || event.shiftKey) return null
			const key = String(event.key ?? '').toLowerCase()
			if (key === 'i') return 'play'
			if (key === ';') return 'reveal'
			return null
		}

		/* ───────────────────────────── Formatting ───────────────────────────── */

		function formatClock(ms) {
			const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
			const minutes = Math.floor(total / 60)
			const seconds = total % 60
			return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
		}

		/**
		 * Practice clock in the design's HH:MM:SS form.
		 * @param {number} ms - elapsed milliseconds.
		 * @returns {string} clock.
		 */
		/**
		 * Whether the practice clock is running.
		 *
		 * The clock pauses on the listen gate, on the result screen, and whenever
		 * the page is hidden or the window loses focus; the topbar dims to 50% so
		 * a paused clock never looks like a running one.
		 * @param {boolean} pageVisible - the page is focused and visible.
		 * @param {string} phase - sentence phase (listening/typing/result).
		 * @returns {boolean} true while the clock advances.
		 */
		function timerRunning(pageVisible, phase) {
			return pageVisible === true && phase === 'typing'
		}

		function formatTimer(ms) {
			const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
			const hours = Math.floor(total / 3600)
			const minutes = Math.floor((total % 3600) / 60)
			const seconds = total % 60
			return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
		}

		/**
		 * A pauseable practice clock: `value()` is live while running, frozen while
		 * paused, and `set(ms)` restores a saved value without starting it.
		 * @param {{now?: () => number}} [options] - injectable clock for tests.
		 * @returns {object} timer controller.
		 */
		function createTimer(options = {}) {
			const now = typeof options.now === 'function' ? options.now : () => Date.now()
			let base = 0
			let start = now()
			let running = false
			return {
				value() {
					return running ? base + Math.max(0, now() - start) : base
				},
				set(ms) {
					base = Math.max(0, Math.floor(Number(ms) || 0))
					start = now()
					running = false
					return base
				},
				resume() {
					if (!running) {
						start = now()
						running = true
					}
					return this.value()
				},
				pause() {
					if (running) {
						base += Math.max(0, now() - start)
						running = false
					}
					return base
				},
				isRunning: () => running,
			}
		}

		/** Shortcut tokens inside a hint get a rounded key cap. */
		const SHORTCUT_KEYS = new Set(['↑', 'Alt', 'Enter', 'Space', '空格', '回车'])
		function shortcutHint(text) {
			return String(text ?? '')
				.split(/(↑|Alt|Enter|Space|空格|回车)/g)
				.map((part, index) => (SHORTCUT_KEYS.has(part) ? h('kbd', { key: index }, part) : part))
		}

		/**
		 * Minutes and seconds for the summary's "took …" line.
		 * @param {number} ms - elapsed milliseconds.
		 * @returns {{minutes: number, seconds: number}} parts.
		 */
		function durationParts(ms) {
			const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
			return { minutes: Math.floor(total / 60), seconds: total % 60 }
		}

		/** Score bands used by the summary and the home badge. */
		function scoreBand(value) {
			const number = Number(value) || 0
			if (number >= 90) return 'excellent'
			if (number >= 75) return 'good'
			if (number >= 60) return 'pass'
			if (number >= 40) return 'weak'
			return 'retry'
		}

		/**
		 * The article's dictation score: spelling accuracy multiplied by listening
		 * fluency (replay factor × efficiency factor). Keep this in sync with
		 * lib/score.js, which the Host uses for legacy completed rows.
		 * @param {object[]} records - completed sentence records.
		 * @param {object} [options] - elapsedMs and referencePace.
		 * @returns {object} score breakdown.
		 */
		function dictationScore(records, options = {}) {
			const list = Array.isArray(records) ? records.filter(Boolean) : []
			const words = list.flatMap((record) => (Array.isArray(record.words) ? record.words : []))
			let credit = 0
			let total = 0
			let firstTry = 0
			let hints = 0
			for (const word of words) {
				if (!word || word.given === true) continue
				total += 1
				const attempts = Math.max(1, Number(word.attempts) || 1)
				const base = attempts <= 1 ? 1 : attempts === 2 ? 0.6 : attempts === 3 ? 0.3 : 0.1
				const before = Math.max(0, Number(word.peekBeforeInput) || 0)
				const after = Math.max(0, Number(word.peekAfterWrong) || 0)
				const onCorrect = Math.max(0, Number(word.peekOnCorrect) || 0)
				const peeks = Math.max(0, Number(word.peeks) || 0)
				let hint = 1
				if (before > 0 && after === 0) hint = 0.25
				else if (after > 0) hint = 0.6
				else if (before > 0) hint = 0.6
				else if (peeks > onCorrect) hint = 0.8
				credit += base * hint
				if (attempts <= 1) firstTry += 1
				hints += Math.max(0, peeks - onCorrect)
			}
			const raw = total === 0 ? 0 : (100 * credit) / total
			const replays = list.reduce((sum, record) => sum + Math.max(0, Number(record.replays) || 0), 0)
			const sentences = list.length
			const avgReplay = sentences === 0 ? 0 : replays / sentences
			const listenFactor = Math.min(1, Math.max(0.8, 1 - 0.04 * Math.max(0, avgReplay - 1)))
			const inferredMs = list.reduce((sum, record) => sum + Math.max(0, Number(record.timeMs) || 0), 0)
			const elapsedMs = Math.max(0, Number(options.elapsedMs) || inferredMs)
			const pace = total > 0 && elapsedMs > 0 ? elapsedMs / 1000 / total : 0
			const referencePace = Math.max(0, Number(options.referencePace) || 0)
			const timeRatio = referencePace > 0 && pace > 0 ? pace / referencePace : 1
			const efficiencyFactor =
				referencePace > 0 ? Math.min(1, Math.max(0.85, 1 - 0.15 * Math.max(0, timeRatio - 1))) : 1
			const comprehension = 100 * listenFactor * efficiencyFactor
			const value = Math.max(0, Math.min(100, Math.round((raw * comprehension) / 100)))
			return {
				value,
				raw: Math.round(raw * 10) / 10,
				comprehension: Math.round(comprehension),
				spelling: Math.round(raw * 10) / 10,
				listenFactor: Math.round(listenFactor * 100) / 100,
				efficiencyFactor: Math.round(efficiencyFactor * 100) / 100,
				timeRatio: Math.round(timeRatio * 100) / 100,
				pace: Math.round(pace * 10) / 10,
				referencePace: Math.round(referencePace * 10) / 10,
				avgReplay: Math.round(avgReplay * 10) / 10,
				firstTry,
				words: total,
				hints,
				replays,
				sentences,
				band: scoreBand(value),
			}
		}

		/**
		 * The median seconds-per-word of completed articles at one level.
		 * @param {object[]} items - saved-library rows.
		 * @param {string} cefr - level.
		 * @param {string} excludeId - current article id.
		 * @returns {number} reference pace, or 0.
		 */
		function referencePaceOf(items, cefr, excludeId) {
			const paces = (Array.isArray(items) ? items : [])
				.filter(
					(item) =>
						item &&
						item.id !== excludeId &&
						item.phase === 'done' &&
						item.cefr === cefr &&
						Number(item.words) > 0 &&
						Number(item.elapsedMs) > 0,
				)
				.map((item) => Number(item.elapsedMs) / 1000 / Number(item.words))
				.filter((value) => Number.isFinite(value) && value > 0)
				.sort((left, right) => left - right)
			if (paces.length < 3) return 0
			return paces[Math.floor(paces.length / 2)]
		}

		function formatNumber(value) {
			const number = Number(value) || 0
			return number.toLocaleString('en-US')
		}

		function dayLabel(iso) {
			const date = new Date(String(iso || ''))
			if (Number.isNaN(date.getTime())) return ''
			const month = String(date.getMonth() + 1).padStart(2, '0')
			const day = String(date.getDate()).padStart(2, '0')
			const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
			return `${month}/${day} ${time}`
		}

		/* ───────────────────────────── HTTP ───────────────────────────── */

		/**
		 * One JSON request to the Host.
		 * @param {string} path - route suffix.
		 * @param {{method?: string, body?: object}} [options] - request.
		 * @returns {Promise<object>} parsed reply.
		 */
		async function request(path, options = {}) {
			const init = {
				method: options.method || 'GET',
				headers: { 'content-type': 'application/json' },
				cache: 'no-store',
			}
			if (options.body !== undefined) init.body = JSON.stringify(options.body)
			const response = await fetch(`${API}${path}`, init)
			let data = null
			try {
				data = await response.json()
			} catch (error) {
				data = null
			}
			if (!response.ok) {
				const code = (data && data.code) || `http-${response.status}`
				const reason = data && typeof data.message === 'string' ? data.message : ''
				// The Host's reason goes into the Error message so the client log keeps
				// it; the page still shows its own localized notice.
				throw Object.assign(new Error(reason === '' ? code : `${code}: ${reason}`), {
					status: response.status,
					code,
					reason,
				})
			}
			return data || {}
		}

		/**
		 * Turn a Host error into the sentence the page shows.
		 *
		 * A failed generation is not a network problem: telling the learner
		 * "the local service is unreachable" when the model simply produced no
		 * usable sentence sends them looking in the wrong place.
		 * @param {(key: string) => string} t - translator.
		 * @param {object} error - thrown request error.
		 * @returns {string} localized message.
		 */
		/**
		 * Whether a request died without any answer from the Host.
		 *
		 * A fetch the browser aborts (or a connection reset) rejects with no
		 * status at all; every HTTP answer, even 500, carries one. The two need
		 * different handling: a lost response can be recovered, a bad one cannot.
		 * @param {object} error - thrown request error.
		 * @returns {boolean} true when no response was received.
		 */
		function isTransportFailure(error) {
			return !error || typeof error.status !== 'number'
		}

		/**
		 * A one-line technical detail for the error card: where it failed and
		 * what the page actually received. A screenshot of this line is enough
		 * to tell a lost response apart from a Host-side refusal.
		 * @param {string} where - the step that failed.
		 * @param {object} error - thrown request error.
		 * @returns {string} detail line.
		 */
		function errorDetailText(where, error) {
			const parts = [where]
			if (error && typeof error.name === 'string' && error.name !== '') parts.push(error.name)
			if (error && typeof error.code === 'string' && error.code !== '') parts.push(error.code)
			if (error && typeof error.status === 'number' && error.status !== 0) parts.push(`HTTP ${error.status}`)
			// No status at all means the page never got an answer from the Host.
			if (!(error && typeof error.status === 'number' && error.status !== 0)) parts.push('no response')
			return parts.join(' · ')
		}

		function generateErrorText(t, error) {
			const code = error && typeof error.code === 'string' ? error.code : ''
			if (code === 'no-run' || code === 'no-active-run' || code === 'stale-run' || code === 'stale-item') {
				return t('practice.runEnded')
			}
			if (code === 'generation-failed') return t('practice.generateFailed')
			return t('error.network')
		}

		const api = {
			profile: () => request('/profile'),
			setBand: (band) => request('/profile/band', { method: 'POST', body: { band } }),
			setSettings: (settings) => request('/profile/settings', { method: 'POST', body: { settings } }),
			start: () => request('/run/start', { method: 'POST', body: {} }),
			answer: (payload) => request('/run/answer', { method: 'POST', body: payload }),
			next: () => request('/run/next', { method: 'POST', body: {} }),
			sources: (force) => request(force === true ? '/sources?force=1' : '/sources'),
			ingestSource: (url) => request('/sources/url', { method: 'POST', body: { url } }),
			favicon: (provider) => `${API}/favicon?provider=${encodeURIComponent(provider)}`,
			sourceArticle: (id) => request(`/sources/article?id=${encodeURIComponent(id)}`),
			sourceRead: (id) => request('/sources/read', { method: 'POST', body: { id } }).catch(() => ({})),
			sourceGenerate: (id, cefr, voice) => request('/sources/generate', { method: 'POST', body: { id, cefr, voice } }),
			savedArticles: () => request('/articles/saved'),
			removeArticle: (id) => request('/articles/remove', { method: 'POST', body: { id } }),
			archivedArticles: () => request('/archive/articles'),
			regenerateArchived: (id, voice) => request('/archive/regenerate', { method: 'POST', body: { id, voice } }),
			articleUnit: (id, voice) =>
				request(`/articles/unit?id=${encodeURIComponent(id)}${voice ? `&voice=${encodeURIComponent(voice)}` : ''}`),
			articleProgress: (id, progress) => request('/articles/progress', { method: 'POST', body: { id, progress } }),
			coach: (payload) => request('/coach', { method: 'POST', body: payload }),
			voice: (payload) => request('/voice', { method: 'POST', body: payload }),
			ttsClear: (texts, voice) => request('/tts/cache', { method: 'POST', body: { action: 'clearTexts', texts, voice } }),
			finish: (abandon) => request('/run/finish', { method: 'POST', body: { abandon: abandon === true } }),
			clientLog: (entry) => request('/client-log', { method: 'POST', body: entry }).catch(() => {}),
			retryReport: (itemId) => request('/report/retry', { method: 'POST', body: { itemId } }),
			tags: () => request('/tags'),
			practiceNext: (tag) => request('/practice/next', { method: 'POST', body: { tag } }),
			practiceDone: (payload) => request('/practice/done', { method: 'POST', body: payload }).catch(() => ({})),
		}

		/* ───────────────────────────── TTS ───────────────────────────── */

		/**
		 * The system TTS wrapper.
		 *
		 * Only `speechSynthesis` is used: no network voice service, no audio files.
		 * `synth` is injectable so the offline test can drive the three branches —
		 * no English voice, speaking, cancelled — without a DOM.
		 *
		 * @param {{synth?: object, SpeechUtterance?: Function, voiceProvider?: Function}} [options] - overrides.
		 * @returns {object} engine.
		 */
		function createTts(options = {}) {
			const synth = Object.prototype.hasOwnProperty.call(options, 'synth')
				? options.synth
				: typeof window !== 'undefined'
					? window.speechSynthesis
					: null
			const Utterance = options.SpeechUtterance
				|| (typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null)
			const listeners = new Set()
			let voices = []
			let preferredName = ''
			let voiceName = ''
			let speaking = false
			let lastError = ''
			let version = 0
			let disposed = false
			let failedSpeak = false
			/** Preferred source: the Host's Edge voice, else the system voice. */
			let engine = 'cloud'
			/** Cloud timbre; `stella` is the endpoint's default. */
			let cloudVoice = CLOUD_VOICES[0]
			/** Whether the Host answered `/tts/status` with a usable key. */
			let cloudReady = false
			/** One shared element, so the gesture spent by `unlock` still counts. */
			let player = null
			/** Best-effort analyser on the shared element, for the sound-reactive glow. */
			let analyserInfo = null
			/** Settles the cloud playback that is in flight, if any. */
			let activeFinish = null
			/** Pause/resume of the current cloud playback. */
			let activeControl = null
			let paused = false
			let currentRate = RATE_NORMAL
			/** text/voice URL → Blob URL (resolved) or Promise (in flight). */
			const prefetched = new Map()

			/**
			 * The shared audio element, created on first use.
			 * @returns {object|null} element, or null without a DOM.
			 */
			function audioElement() {
				if (disposed) return null
				if (player !== null) return player
				if (typeof window === 'undefined' || typeof window.Audio !== 'function') return null
				try {
					player = new window.Audio()
				} catch (error) {
					player = null
				}
				return player
			}

			/**
			 * An analyser reading the shared player, for the sound-reactive glow.
			 *
			 * The element keeps playing through its own output: `captureStream`
			 * duplicates the audio into a graph instead of re-routing it, so a
			 * suspended AudioContext can never silence a spoken sentence. When the
			 * browser has no `captureStream` or no AudioContext, this returns null
			 * and the glow falls back to a synthetic pulse.
			 * @returns {{context: object, node: object, bins: Uint8Array}|null} analyser.
			 */
			function analyser() {
				if (disposed || player === null) return null
				if (analyserInfo !== null) {
					if (analyserInfo.context && analyserInfo.context.state === 'suspended') {
						Promise.resolve(analyserInfo.context.resume()).catch(() => {})
					}
					return analyserInfo
				}
				const Context = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null
				if (typeof Context !== 'function' || typeof player.captureStream !== 'function') return null
				try {
					const stream = player.captureStream()
					const track = stream && typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks()[0] : null
					if (!track) return null
					const context = new Context()
					const source = context.createMediaStreamSource(stream)
					const node = context.createAnalyser()
					node.fftSize = 256
					node.smoothingTimeConstant = 0.65
					source.connect(node)
					analyserInfo = { context, node, bins: new Uint8Array(node.frequencyBinCount) }
					if (context.state === 'suspended') Promise.resolve(context.resume()).catch(() => {})
					return analyserInfo
				} catch (error) {
					return null
				}
			}

			function emit() {
				version += 1
				for (const listener of Array.from(listeners)) {
					try {
						listener()
					} catch (error) {
						/* one broken subscriber must not block the rest */
					}
				}
			}

			function subscribe(listener) {
				listeners.add(listener)
				return () => listeners.delete(listener)
			}

			function englishVoices() {
				return voices.filter((voice) => voice && typeof voice.lang === 'string' && /^en/i.test(voice.lang))
			}

			/**
			 * Pick the voice to speak with: the saved one, then the documented
			 * preference list, then any en-US voice, then any English voice.
			 * @param {string} [name] - saved voice name.
			 * @returns {object|null} voice.
			 */
			function pickVoice(name) {
				const english = englishVoices()
				if (name) {
					const exact = english.find((voice) => voice.name === name)
					if (exact) return exact
				}
				for (const candidate of PREFERRED_VOICES) {
					const hit = english.find((voice) => String(voice.name).includes(candidate))
					if (hit) return hit
				}
				const us = english.find((voice) => /^en[-_]US/i.test(voice.lang))
				return us || english[0] || null
			}

			function refresh() {
				if (disposed) return
				if (!synth || typeof synth.getVoices !== 'function') {
					voices = []
					emit()
					return
				}
				try {
					voices = Array.from(synth.getVoices() || [])
				} catch (error) {
					voices = []
				}
				const chosen = pickVoice(preferredName)
				voiceName = chosen ? chosen.name : ''
				emit()
			}

			function setVoice(name) {
				preferredName = typeof name === 'string' ? name : ''
				const chosen = pickVoice(preferredName)
				voiceName = chosen ? chosen.name : ''
				emit()
			}

			/**
			 * Choose the speaking source.
			 * @param {string} name - `cloud` or `system`; anything else is ignored.
			 * @returns {void}
			 */
			function setEngine(name) {
				const next = name === 'system' ? 'system' : name === 'cloud' ? 'cloud' : engine
				if (next === engine) return
				engine = next
				emit()
			}

			/**
			 * Choose the cloud timbre.
			 * @param {string} name - `stella` or `tide`; anything else is ignored.
			 * @returns {void}
			 */
			function setCloudVoice(name) {
				if (!CLOUD_VOICES.includes(name) || name === cloudVoice) return
				cloudVoice = name
				emit()
			}

			/**
			 * Record whether the Host can synthesize local audio.
			 * @param {boolean} value - `/tts/status` readiness.
			 * @returns {void}
			 */
			function setCloudReady(value) {
				const next = value === true
				if (next === cloudReady) return
				cloudReady = next
				emit()
			}

			/**
			 * Ask the Host whether it can synthesise local speech.
			 *
			 * Best effort: a page opened before the Host is ready keeps the system
			 * voice and retries on the next mount.
			 * @returns {Promise<boolean>} readiness.
			 */
			async function checkCloud() {
				if (typeof fetch !== 'function') return false
				try {
					const response = await fetch(`${API}/tts/status`, { method: 'GET' })
					if (!response || response.ok !== true) return cloudReady
					const data = await response.json()
					setCloudReady(data && data.ready === true)
					return cloudReady
				} catch (error) {
					return cloudReady
				}
			}

			function init(name) {
				if (typeof name === 'string' && name !== '') preferredName = name
				refresh()
				if (synth && typeof synth.addEventListener === 'function') {
					synth.addEventListener('voiceschanged', refresh)
				}
			}

			function dispose() {
				if (disposed) return
				disposed = true
				if (synth && typeof synth.removeEventListener === 'function') {
					synth.removeEventListener('voiceschanged', refresh)
				}
				cancel()
				if (analyserInfo !== null) {
					try {
						Promise.resolve(analyserInfo.context.close()).catch(() => {})
					} catch (error) {
						/* the context dies with the page anyway */
					}
					analyserInfo = null
				}
				try {
					if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
						for (const value of prefetched.values()) if (typeof value === 'string') URL.revokeObjectURL(value)
					}
				} catch (error) {
					/* blobs are cleared with the page anyway */
				}
				prefetched.clear()
				listeners.clear()
			}

			function cancel() {
				if (activeFinish !== null) activeFinish('cancel')
				activeControl = null
				paused = false
				if (synth && typeof synth.cancel === 'function') {
					try {
						synth.cancel()
					} catch (error) {
						/* cancelling an idle synthesiser is not an error */
					}
				}
				speaking = false
				emit()
			}

			/** The Host URL for one cloud phrase. */
			function audioUrl(content) {
				return `${API}/audio?text=${encodeURIComponent(content)}&voice=${encodeURIComponent(cloudVoice)}&v=2`
			}

			/**
			 * Download a cloud phrase ahead of time and keep a Blob URL, so the next
			 * sentence starts immediately instead of waiting on synthesis.
			 * @param {string} text - English phrase.
			 * @returns {void}
			 */
			function prefetch(text) {
				if (disposed || engine !== 'cloud' || !cloudReady) return
				if (typeof fetch !== 'function') return
				const content = String(text ?? '').trim()
				if (content === '') return
				const url = audioUrl(content)
				if (prefetched.has(url)) return
				const task = fetch(url)
					.then((response) => (response && response.ok === true ? response.blob() : null))
					.then((blob) => {
						if (!blob || disposed) return null
						if (prefetched.get(url) !== task) return null
						if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null
						const objectUrl = URL.createObjectURL(blob)
						prefetched.set(url, objectUrl)
						return objectUrl
					})
					.catch(() => null)
				prefetched.set(url, task)
			}

			/**
			 * Forget the prefetched copy of one phrase: revoke its Blob URL and stop an
			 * in-flight prefetch from landing back in the map.
			 * @param {string} text - English phrase.
			 * @returns {void}
			 */
			function release(text) {
				const content = String(text ?? '').trim()
				if (content === '') return
				const url = audioUrl(content)
				const cached = prefetched.get(url)
				if (typeof cached === 'string') {
					try {
						if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(cached)
					} catch (error) {
						/* the Blob dies with the page anyway */
					}
				}
				prefetched.delete(url)
			}

			/**
			 * Release the prefetched audio of a whole finished article.
			 * @param {string[]} texts - article sentences.
			 * @returns {void}
			 */
			function releaseMany(texts) {
				for (const text of Array.isArray(texts) ? texts : []) release(text)
			}

			/**
			 * Speak text: the Host's MP3/WAV first, the system voice as the
			 * fallback. Returns false only when neither can speak.
			 *
			 * The endpoint has no speed parameter, so `rate` is applied here on the
			 * audio element (pitch preserved) — the same knob the system voice gets.
			 *
			 * @param {string} text - English text.
			 * @param {{rate?: number, voiceName?: string, systemOnly?: boolean}} [config] - playback config.
			 * @returns {boolean} whether speaking started.
			 */
			function speak(text, config = {}) {
				const content = String(text ?? '').trim()
				if (content === '') return false
				const rate = Number.isFinite(Number(config.rate)) ? clamp(Number(config.rate), 0.5, 2) : RATE_NORMAL
				currentRate = rate
				const useCloud = engine === 'cloud' && cloudReady && config.systemOnly !== true
				const element = useCloud ? audioElement() : null
				if (element === null) return speakSynth(content, { ...config, rate })

				// A phrase the learner already moved past must not resurface through
				// the fallback when its watchdog fires.
				if (activeFinish !== null) activeFinish('cancel')
				activeControl = null
				paused = false
				speaking = true
				emit()
				let settled = false
				let watchdog = 0
				let control = null
				/**
				 * End the cloud playback exactly once.
				 * @param {boolean|string} outcome - true: played, false: failed (fall
				 * back to the system voice), 'cancel': the learner moved on.
				 * @returns {void}
				 */
				const finish = (outcome) => {
					if (settled) return
					settled = true
					if (activeFinish === finish) activeFinish = null
					if (activeControl === control) activeControl = null
					paused = false
					if (watchdog !== 0) clearTimeout(watchdog)
					speaking = false
					emit()
					if (outcome === true) {
						if (typeof config.onEnd === 'function') config.onEnd()
						return
					}
					try {
						element.pause()
					} catch (error) {
						/* ignore */
					}
					if (outcome === false) speakSynth(content, { ...config, rate })
				}
				activeFinish = finish
				control = {
					pause() {
						if (settled || paused || element.paused) return false
						try {
							element.pause()
						} catch (error) {
							return false
						}
						if (watchdog !== 0) {
							clearTimeout(watchdog)
							watchdog = 0
						}
						speaking = false
						paused = true
						emit()
						return true
					},
					resume() {
						if (settled || !paused) return false
						try {
							const result = element.play()
							if (result && typeof result.catch === 'function') result.catch(() => finish(false))
						} catch (error) {
							return false
						}
						paused = false
						speaking = true
						emit()
						if (watchdog !== 0) clearTimeout(watchdog)
						watchdog = setTimeout(() => finish(false), 12000)
						return true
					},
					isPaused: () => paused,
				}
				activeControl = control
				try {
					element.muted = false
					const url = audioUrl(content)
					const cached = prefetched.get(url)
					element.src = typeof cached === 'string' ? cached : url
				} catch (error) {
					finish(false)
					return true
				}
				// Slower or faster without the chipmunk effect; both names cover the
				// browsers that shipped the flag under a prefix.
				try {
					if ('preservesPitch' in element) element.preservesPitch = true
					else if ('mozPreservesPitch' in element) element.mozPreservesPitch = true
				} catch (error) {
					/* the rate still applies, only the pitch may shift */
				}
				try {
					element.playbackRate = rate
				} catch (error) {
					/* the phrase plays at 1.0 rather than not at all */
				}
				element.onended = () => finish(true)
				element.onerror = () => finish(false)
				const result = element.play()
				if (result && typeof result.catch === 'function') result.catch(() => finish(false))
				watchdog = setTimeout(() => finish(false), 12000)
				return true
			}

			function speakSynth(text, config = {}) {
				if (!synth || typeof Utterance !== 'function') {
					lastError = 'unsupported'
					emit()
					return false
				}
				const content = String(text ?? '').trim()
				if (content === '') return false
				const voice = pickVoice(config.voiceName || preferredName)
				if (voice === null) {
					lastError = 'no-voice'
					failedSpeak = true
					emit()
					return false
				}
				failedSpeak = false
				try {
					synth.cancel()
				} catch (error) {
					/* ignore */
				}
				const rate = Number.isFinite(Number(config.rate)) ? clamp(Number(config.rate), 0.5, 2) : RATE_NORMAL
				let utterance = null
				try {
					utterance = new Utterance(content)
				} catch (error) {
					lastError = 'unsupported'
					emit()
					return false
				}
				utterance.voice = voice
				utterance.lang = voice.lang || 'en-US'
				utterance.rate = rate
				utterance.pitch = 1
				utterance.volume = 1
				utterance.onstart = () => {
					speaking = true
					paused = false
					emit()
				}
				utterance.onend = () => {
					speaking = false
					paused = false
					emit()
					if (typeof config.onEnd === 'function') {
						try {
							config.onEnd()
						} catch (error) {
							/* a chained cue must never break the engine */
						}
					}
				}
				utterance.onerror = (event) => {
					speaking = false
					paused = false
					lastError = (event && event.error) || 'error'
					emit()
				}
				paused = false
				speaking = true
				try {
					synth.speak(utterance)
				} catch (error) {
					speaking = false
					lastError = 'speak-failed'
					emit()
					return false
				}
				emit()
				return true
			}

			/**
			 * Spend one user gesture on an inaudible utterance, so a later automatic
			 * sentence is allowed to play.
			 *
			 * The system synthesiser and the shared audio element each get a silent
			 * turn: whichever source speaks next has already been unlocked.
			 * @returns {void}
			 */
			function unlock() {
				const audio = audioElement()
				if (audio !== null) {
					try {
						audio.src = SILENT_WAV
						audio.muted = true
						const result = audio.play()
						if (result && typeof result.catch === 'function') result.catch(() => {})
					} catch (error) {
						/* the system utterance below may still unlock playback */
					}
				}
				if (!synth || typeof Utterance !== 'function') return
				try {
					const utterance = new Utterance(' ')
					utterance.volume = 0
					synth.speak(utterance)
				} catch (error) {
					/* the browser may still allow plain speech() later */
				}
			}

			return {
				init,
				dispose,
				speak,
				cancel,
				setRate(value) {
					currentRate = clamp(Number(value) || RATE_NORMAL, 0.5, 2)
					if (player && !disposed) {
						try {
							player.playbackRate = currentRate
							if ('preservesPitch' in player) player.preservesPitch = true
							else if ('mozPreservesPitch' in player) player.mozPreservesPitch = true
						} catch (error) {
							/* the next speak applies it */
						}
					}
					return currentRate
				},
				pause() {
					if (activeControl) return activeControl.pause()
					if (synth && synth.speaking && synth.paused !== true) {
						try {
							synth.pause()
						} catch (error) {
							return false
						}
						speaking = false
						paused = true
						emit()
						return true
					}
					return false
				},
				resume() {
					if (activeControl) return activeControl.resume()
					if (synth && synth.paused === true) {
						try {
							synth.resume()
						} catch (error) {
							return false
						}
						paused = false
						speaking = true
						emit()
						return true
					}
					return false
				},
				isPaused: () => paused,
				unlock,
				prefetch,
				release,
				releaseMany,
				refresh,
				setVoice,
				setEngine,
				setCloudVoice,
				setCloudReady,
				checkCloud,
				subscribe,
				getVersion: () => version,
				englishVoices,
				hasEnglish: () => englishVoices().length > 0,
				/** Whether either source can actually read a sentence aloud. */
				canSpeak: () => englishVoices().length > 0 || (engine === 'cloud' && cloudReady),
				engine: () => engine,
				cloudVoice: () => cloudVoice,
				cloudReady: () => cloudReady,
				isSpeaking: () => speaking,
				analyser,
				lastError: () => lastError,
				voiceName: () => voiceName,
				failedSpeak: () => failedSpeak,
				__setVoices(next) {
					voices = Array.isArray(next) ? next : []
					const chosen = pickVoice(preferredName)
					voiceName = chosen ? chosen.name : ''
					emit()
				},
			}
		}

		/* ───────────────────────────── Sound ───────────────────────────── */

		/**
		 * WebAudio-synthesised cues at roughly 40% volume: no audio files.
		 * @returns {object} sound engine.
		 */
		function createSound() {
			let context = null
			let enabled = true

			function ensure() {
				if (context !== null) return context
				if (typeof window === 'undefined') return null
				const Constructor = window.AudioContext || window.webkitAudioContext
				if (!Constructor) return null
				try {
					context = new Constructor()
				} catch (error) {
					context = null
				}
				return context
			}

			function tone(frequency, delay, duration, gain) {
				const audio = ensure()
				if (audio === null) return
				try {
					// The check can be the first sound after a gesture; resume here so a
					// suspended context never swallows the error tone.
					if (audio.state === 'suspended') audio.resume().catch(() => {})
					const oscillator = audio.createOscillator()
					const volume = audio.createGain()
					const start = audio.currentTime + delay
					oscillator.type = 'sine'
					oscillator.frequency.value = frequency
					volume.gain.setValueAtTime(0.0001, start)
					volume.gain.linearRampToValueAtTime(gain, start + 0.012)
					volume.gain.exponentialRampToValueAtTime(0.0001, start + duration)
					oscillator.connect(volume)
					volume.connect(audio.destination)
					oscillator.start(start)
					oscillator.stop(start + duration + 0.02)
				} catch (error) {
					/* audio is a nicety */
				}
			}


			/** A soft mechanical “ta”: a filtered noise click plus a short low body. */
			function click() {
				if (!enabled) return
				const audio = ensure()
				if (audio === null) return
				try {
					const duration = 0.025
					const length = Math.max(1, Math.floor(audio.sampleRate * duration))
					const buffer = audio.createBuffer(1, length, audio.sampleRate)
					const data = buffer.getChannelData(0)
					for (let index = 0; index < length; index += 1) {
						const envelope = 1 - index / length
						data[index] = (Math.random() * 2 - 1) * envelope * envelope
					}
					const source = audio.createBufferSource()
					source.buffer = buffer
					const filter = audio.createBiquadFilter()
					filter.type = 'bandpass'
					filter.frequency.value = 1700
					filter.Q.value = 0.9
					const volume = audio.createGain()
					volume.gain.value = 0.07
					source.connect(filter)
					filter.connect(volume)
					volume.connect(audio.destination)
					source.start()
					tone(165 + Math.random() * 25, 0, 0.04, 0.03)
				} catch (error) {
					/* audio is a nicety */
				}
			}

			return {
				setEnabled(value) {
					enabled = value === true
				},
				isEnabled: () => enabled,
				resume() {
					const audio = ensure()
					if (audio && audio.state === 'suspended') {
						audio.resume().catch(() => {})
					}
				},
				key() {
					click()
				},
				correct() {
					if (!enabled) return
					tone(880, 0, 0.08, 0.07)
					tone(1320, 0.055, 0.1, 0.05)
				},
				/** Whole article finished: a small congratulatory fanfare. */
				congrats() {
					if (!enabled) return
					const notes = [523.25, 659.25, 783.99, 1046.5]
					notes.forEach((frequency, index) => tone(frequency, index * 0.12, 0.32, 0.065))
					tone(1318.51, 0.52, 0.5, 0.05)
					tone(1046.5, 0.52, 0.5, 0.04)
				},
				wrong() {
					if (!enabled) return
					// A descending minor third is audible on laptop speakers; the old
					// 170 Hz thud was below most speakers' useful range.
					tone(392, 0, 0.1, 0.09)
					tone(311, 0.1, 0.18, 0.08)
				},
				combo(count) {
					if (!enabled) return
					const base = 620 + Math.min(12, Math.max(0, Number(count) || 0)) * 35
					tone(base, 0, 0.07, 0.06)
					tone(base * 1.5, 0.06, 0.1, 0.05)
				},
				play(result) {
					if (result === 'perfect' || result === 'great') this.correct()
					else this.wrong()
				},
			}
		}

		/* ───────────────────────────── Styles ───────────────────────────── */

		const CSS = `
.dsh-de-page {
	/* One content column for every screen, matching the DSH plugin list page:
	   the same clamp(24px, 4vw, 48px) inset and 960px cap. */
	--de-page-inset: clamp(24px, 4vw, 48px);
	--de-page-max: 960px;
	/* DSH's light theme sets bg-layer-2 to plain white, so a card using it would
	   vanish on the white page. A tint of the text colour reads as the same
	   subtle grey in both themes. */
	--de-fill: color-mix(in oklab, var(--dsw-alias-label-primary, #16171a) 7%, transparent);
	--de-fill-strong: color-mix(in oklab, var(--dsw-alias-label-primary, #16171a) 12%, transparent);
	position: relative;
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 100%;
	box-sizing: border-box;
	overflow-y: auto;
	overflow-x: hidden;
	background: var(--dsw-alias-bg-base, #fff);
	color: var(--dsw-alias-label-primary, #1f2328);
	font-size: 14px;
	line-height: 1.5;
}
@media (max-width: 767px) {
	.dsh-de-page { --de-page-inset: 20px; }
}
/* The legacy tag-practice page shares the same column variables. */
.dsh-de-practice {
	--de-page-inset: clamp(24px, 4vw, 48px);
	--de-page-max: 960px;
	--de-fill: color-mix(in oklab, var(--dsw-alias-label-primary, #16171a) 7%, transparent);
	--de-fill-strong: color-mix(in oklab, var(--dsw-alias-label-primary, #16171a) 12%, transparent);
}
@media (max-width: 767px) {
	.dsh-de-practice { --de-page-inset: 20px; }
}

/* ── article-scoped AI teacher ── */
.dsh-de-coach-host { position: relative; height: 100%; min-height: 100%; box-sizing: border-box; transition: padding-right .18s ease; }
.dsh-de-coach-host-open { padding-right: 360px; }
.dsh-de-coach-host > .dsh-de-page { height: 100%; }
.dsh-de-coach {
	position: absolute; top: 0; right: 0; bottom: 0; width: 360px; z-index: 3;
	display: flex; flex-direction: column; min-height: 0;
	background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #1f2328);
	border-left: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12));
	box-shadow: -10px 0 30px rgba(0,0,0,.05);
}
.dsh-de-coach-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 14px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.10)); }
.dsh-de-coach-heading { min-width: 0; }
.dsh-de-coach-title { font-size: 14px; font-weight: 650; }
.dsh-de-coach-sub { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-de-coach-thread { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 14px; }
.dsh-de-coach-empty { margin: auto 0; display: flex; flex-direction: column; gap: 12px; }
.dsh-de-coach-empty-title { font-size: 14px; color: var(--dsw-alias-label-secondary, #6b7280); line-height: 1.5; }
.dsh-de-coach-suggestions { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.dsh-de-coach-suggestion {
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); border-radius: 8px;
	background: transparent; color: var(--dsw-alias-label-primary, #1f2328);
	font: inherit; font-size: 12px; line-height: 1.5; text-align: left; padding: 7px 9px; cursor: pointer;
}
.dsh-de-coach-suggestion:hover { background: var(--de-fill, rgba(127,127,127,.08)); }
.dsh-de-coach-message { max-width: 88%; padding: 8px 10px; border-radius: 10px; font-size: 13px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }
.dsh-de-coach-message[data-role="user"] { align-self: flex-end; background: var(--dsw-alias-brand-primary, #4f6bed); color: var(--dsw-alias-bg-base, #fff); }
.dsh-de-coach-message[data-role="assistant"] { align-self: flex-start; background: var(--de-fill, rgba(127,127,127,.08)); color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-composer {
	margin: 10px 12px 12px; padding: 8px 10px 6px;
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12)); border-radius: 18px;
	background: var(--dsw-alias-bg-layer-1, #fff);
	transition: border-color .12s ease, box-shadow .12s ease;
}
.dsh-de-composer:focus-within {
	border-color: var(--dsw-alias-brand-primary, #4f6bed);
	box-shadow: 0 0 0 3px rgba(79, 107, 237, .12);
}
.dsh-de-composer textarea {
	width: 100%; min-height: 38px; max-height: 140px; box-sizing: border-box; resize: none;
	border: 0; outline: none; background: transparent; color: inherit;
	font: inherit; font-size: 13px; line-height: 1.6; padding: 2px 2px 4px;
	field-sizing: content;
}
.dsh-de-composer-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 2px; }
.dsh-de-composer-voice {
	width: 30px; height: 30px; border: 0; border-radius: 50%; padding: 0;
	display: inline-flex; align-items: center; justify-content: center;
	background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);
	cursor: pointer;
}
.dsh-de-composer-voice:hover { background: var(--de-fill, rgba(127,127,127,.08)); color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-composer-voice[data-listening="true"] { background: rgba(220, 38, 38, .10); color: #dc2626; }
.dsh-de-composer-voice[data-busy="true"], .dsh-de-composer-voice:disabled { opacity: .5; cursor: default; }
.dsh-de-composer-error { padding: 0 2px 3px; font-size: 11px; line-height: 1.4; color: #dc2626; }
.dsh-de-composer-send {
	width: 30px; height: 30px; border: 0; border-radius: 50%; padding: 0;
	display: inline-flex; align-items: center; justify-content: center;
	background: var(--dsw-alias-brand-primary, #4f6bed); color: #fff;
	font-size: 16px; line-height: 1; cursor: pointer;
}
.dsh-de-composer-send:disabled { opacity: .4; cursor: default; }
@media (max-width: 720px) {
	.dsh-de-coach-host-open { padding-right: 0; }
	.dsh-de-coach { width: min(360px, 100%); }
}
.dsh-de-wrap { width: 100%; max-width: calc(var(--de-page-max) + 2 * var(--de-page-inset)); margin: 0 auto; padding: 26px var(--de-page-inset) 40px; box-sizing: border-box; }
.dsh-de-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.dsh-de-title { font-size: 21px; font-weight: 650; letter-spacing: .2px; }
.dsh-de-subtitle { font-size: 13px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-card {
	background: var(--dsw-alias-bg-layer-1, #fff);
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
	border-radius: 14px;
	padding: 16px 18px;
	box-sizing: border-box;
}
.dsh-de-card + .dsh-de-card { margin-top: 14px; }
.dsh-de-muted { color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dsh-de-spacer { flex: 1 1 auto; }
.dsh-de-chip {
	display: inline-flex; align-items: center; gap: 6px;
	padding: 3px 9px; border-radius: 999px;
	background: var(--de-fill, rgba(127,127,127,.08));
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
	font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280);
	white-space: nowrap;
}
.dsh-de-chip[data-tone="brand"] { color: var(--dsw-alias-brand-primary, #4f6bed); border-color: currentColor; }
.dsh-de-chip[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary, #b45309); border-color: currentColor; }
.dsh-de-stats { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.dsh-de-stat { display: flex; flex-direction: column; gap: 2px; min-width: 74px; }
.dsh-de-stat-label { font-size: 11px; letter-spacing: .4px; text-transform: uppercase; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-stat-value { font-size: 19px; font-weight: 650; font-variant-numeric: tabular-nums; }
.dsh-de-meter { flex: 1 1 180px; min-width: 140px; display: flex; flex-direction: column; gap: 6px; }
.dsh-de-meter-track { height: 6px; border-radius: 999px; background: var(--de-fill-strong, rgba(127,127,127,.16)); overflow: hidden; }
.dsh-de-meter-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-brand-primary, #4f6bed); transition: width .25s ease; }
.dsh-de-primary {
	width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;
	padding: 15px 20px; border-radius: 12px; cursor: pointer;
	font-size: 16px; font-weight: 600; font-family: inherit;
	color: #fff !important; background: #4f6bed !important;
	border: 1px solid transparent;
	transition: filter .12s ease, transform .12s ease;
}
.dsh-de-primary:hover { filter: brightness(1.06); }
.dsh-de-primary:active { transform: translateY(1px); }
.dsh-de-primary:disabled { opacity: .55; cursor: default; }
.dsh-de-secondary {
	display: inline-flex; align-items: center; gap: 6px;
	padding: 7px 12px; border-radius: 9px; cursor: pointer;
	font-size: 13px; font-family: inherit;
	color: var(--dsw-alias-label-primary, #1f2328);
	background: var(--de-fill, rgba(127,127,127,.08));
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1));
}
.dsh-de-secondary:hover { border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.2)); }
.dsh-de-secondary.dsh-de-on {
	color: var(--dsw-alias-brand-primary, #4f6bed);
	border-color: var(--dsw-alias-brand-primary, #4f6bed);
	background: color-mix(in oklab, var(--dsw-alias-brand-primary, #4f6bed) 10%, transparent);
}
.dsh-de-link {
	appearance: none; background: none; border: 0; padding: 2px 0; cursor: pointer;
	font-size: 13px; font-family: inherit; color: var(--dsw-alias-label-secondary, #6b7280);
	text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--dsw-alias-border-l2, rgba(0,0,0,.2));
}
.dsh-de-link:hover { color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-bands { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
@media (max-width: 620px) { .dsh-de-bands { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.dsh-de-band {
	display: flex; flex-direction: column; align-items: center; gap: 2px;
	padding: 14px 8px; border-radius: 11px; cursor: pointer; font-family: inherit;
	color: var(--dsw-alias-label-primary, #1f2328);
	background: var(--de-fill, rgba(127,127,127,.06));
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
	transition: border-color .12s ease, background .12s ease;
}
.dsh-de-band:hover { border-color: var(--dsw-alias-brand-primary, #4f6bed); background: color-mix(in oklab, var(--dsw-alias-brand-primary, #4f6bed) 8%, transparent); }
.dsh-de-band-id { font-size: 16px; font-weight: 650; }
.dsh-de-band-theta { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-footer { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 22px; }
.dsh-de-archlist { margin-top: 8px; }
.dsh-de-archrow {
	display: flex; align-items: center; gap: 12px;
	padding: 10px 0; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
}
.dsh-de-archrow:last-child { border-bottom: 0; padding-bottom: 0; }
.dsh-de-archmain { flex: 1 1 auto; min-width: 0; }
.dsh-de-archtitle { font-size: 14px; color: var(--dsw-alias-label-primary, #15161c); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-de-archmeta { margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-archrow .dsh-de-secondary { flex: none; font-size: 12px; padding: 6px 10px; }
.dsh-de-run-list { display: flex; flex-direction: column; gap: 0; margin-top: 8px; }
.dsh-de-run-row {
	display: flex; align-items: center; gap: 12px; padding: 10px 2px;
	border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));
	font-size: 13px;
}
.dsh-de-run-row:first-child { border-top: 0; }
.dsh-de-run-when { width: 92px; flex: none; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; }
.dsh-de-run-main { flex: 1 1 auto; }
.dsh-de-run-grade { font-weight: 650; font-variant-numeric: tabular-nums; }
.dsh-de-tag-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: 13px; }
.dsh-de-tag-name { width: 92px; flex: none; }
.dsh-de-tag-track { flex: 1 1 auto; height: 6px; border-radius: 999px; background: var(--de-fill-strong, rgba(127,127,127,.16)); overflow: hidden; }
.dsh-de-tag-fill { height: 100%; border-radius: 999px; background: var(--dsw-alias-state-success-primary, #16a34a); }
.dsh-de-tag-value { width: 42px; flex: none; text-align: right; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary, #6b7280); }

/* practice */
.dsh-de-practice { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 100%; box-sizing: border-box; background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary, #1f2328); }
/* The practice page is full-bleed: its bar, stage and footer span the whole
   panel (only the centred sentence/feedback column is capped for readability). */
.dsh-de-topbar {
	position: relative; z-index: 1;
	display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
	width: 100%; box-sizing: border-box;
	padding: 12px 20px; border-bottom: 0;
	background: transparent;
}
.dsh-de-topbar.dsh-de-topbar-plain {
	border-bottom: 0; background: transparent;
}
.dsh-de-topbar-title { display: flex; flex-direction: column; line-height: 1.25; }
.dsh-de-topbar-title b { font-size: 15px; font-weight: 650; }
.dsh-de-topbar-title span { font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-topbar-stats { display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap; }
.dsh-de-icobtn {
	width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
	border-radius: 8px; cursor: pointer; font-size: 15px; line-height: 1;
	color: var(--dsw-alias-label-secondary, #6b7280);
	background: transparent; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.1));
}
.dsh-de-icobtn:hover { color: var(--dsw-alias-label-primary, #1f2328); border-color: var(--dsw-alias-border-l2, rgba(0,0,0,.25)); }
.dsh-de-icobtn.dsh-de-icobtn-ghost { border-color: transparent; background: transparent; }
.dsh-de-icobtn.dsh-de-icobtn-ghost:hover { background: var(--de-fill, rgba(127,127,127,.08)); border-color: transparent; }
.dsh-de-icobtn:disabled { opacity: .35; cursor: default; }
.dsh-de-icobtn:disabled:hover { background: transparent; border-color: transparent; }
.dsh-de-stage {
	flex: 1 1 auto; min-height: 0; overflow: auto;
	display: flex; flex-direction: column; align-items: center; justify-content: center;
	gap: 20px; padding: 28px 20px 32px;
}
.dsh-de-play {
	width: 74px; height: 74px; border-radius: 50%; cursor: pointer;
	display: inline-flex; align-items: center; justify-content: center; gap: 3px;
	color: #fff; background: var(--dsw-alias-brand-primary, #4f6bed);
	border: 0; box-shadow: 0 8px 22px color-mix(in oklab, var(--dsw-alias-brand-primary, #4f6bed) 28%, transparent);
	transition: transform .12s ease, filter .12s ease;
}
.dsh-de-play:hover { filter: brightness(1.06); }
.dsh-de-play:active { transform: scale(.97); }
.dsh-de-play[data-speaking="true"] { animation: dsh-de-pulse 1.2s ease-in-out infinite; }
.dsh-de-wave { display: inline-flex; align-items: center; gap: 3px; height: 22px; }
.dsh-de-wave i { width: 2px; border-radius: 0; background: currentColor; display: block; }
.dsh-de-wave[data-speaking="true"] i { animation: dsh-de-wave 900ms ease-in-out infinite; }
.dsh-de-wave[data-speaking="true"] i:nth-child(2) { animation-delay: 120ms; }
.dsh-de-wave[data-speaking="true"] i:nth-child(3) { animation-delay: 240ms; }
.dsh-de-wave[data-speaking="true"] i:nth-child(4) { animation-delay: 360ms; }
.dsh-de-hint { font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-hint kbd {
	font-family: inherit; font-size: 11px; padding: 1px 5px; border-radius: 5px;
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.16));
	background: var(--de-fill, rgba(127,127,127,.08));
}
/* One underline per word, one input per underline: a question is a row of word
   boxes, each as wide as its word. Space moves to the next box, Enter checks. */
.dsh-de-listen { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 8px 0; }
.dsh-de-listen-hint { font-size: 12px; color: var(--dsw-alias-label-secondary, #9ca3af); }
.dsh-de-listen-text { font-size: 14px; letter-spacing: .4px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-cn-hint {
	display: flex; flex-direction: column; align-items: center; gap: 6px;
	padding: 6px 14px; border-radius: 10px;
	background: var(--de-fill, rgba(127,127,127,.08));
	color: var(--dsw-alias-label-primary, #1f2328);
	font-size: 18px; letter-spacing: .5px;
}

/* ── home ── */
/* The first screen is the design's: title + one action, five counters, then
   every exercise. No cards, no borders: the list is the page. */
.dsh-de-homewrap { width: 100%; max-width: calc(var(--de-page-max) + 2 * var(--de-page-inset)); margin: 0 auto; padding: 60px var(--de-page-inset) 40px; box-sizing: border-box; }
.dsh-de-homehead { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 31px; }
.dsh-de-homeheading { min-width: 0; }
.dsh-de-hometitle {
	margin: 0; font-size: 30px; font-weight: 500; letter-spacing: -.1px; line-height: 1.16;
	color: var(--dsw-alias-label-primary, #0d0d0f);
}
.dsh-de-homesub {
	margin: 0; font-size: 14px; line-height: 1.4;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 56%, transparent);
}
.dsh-de-homeactions { flex: none; display: flex; align-items: center; gap: 10px; margin-top: 5px; }
.dsh-de-addbtn {
	display: inline-flex; align-items: center; gap: 8px;
	padding: 9px 18px; border: 0; border-radius: 999px; cursor: pointer;
	font: inherit; font-size: 13px; font-weight: 550; white-space: nowrap;
	color: var(--dsw-alias-bg-base, #fff); background: var(--dsw-alias-label-primary, #16171a);
	transition: filter .12s ease, transform .12s ease;
}
.dsh-de-addbtn:hover { filter: brightness(1.15); }
.dsh-de-addbtn:active { transform: translateY(1px); }
.dsh-de-menu { position: relative; }
/* A row's menu drops below the whole row, not below its 22px ⋮ button. */
.dsh-de-menu-row { position: static; }
.dsh-de-morebtn, .dsh-de-rowmore {
	list-style: none; display: inline-flex; align-items: center; justify-content: center;
	padding: 0; border: 0; border-radius: 8px; cursor: pointer;
	background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);
}
.dsh-de-morebtn { width: 28px; height: 28px; }
.dsh-de-rowmore { width: 14px; height: 22px; }
.dsh-de-morebtn::-webkit-details-marker, .dsh-de-rowmore::-webkit-details-marker { display: none; }
.dsh-de-morebtn::marker, .dsh-de-rowmore::marker { content: ''; }
.dsh-de-morebtn:hover, .dsh-de-rowmore:hover {
	background: var(--de-fill, rgba(127,127,127,.1));
	color: var(--dsw-alias-label-primary, #1f2328);
}
/* Same surface as icon-studio's context menus: a compact dark panel with
   one-line rows, a hairline border and a single destructive row in red. */
.dsh-de-menu-panel {
	position: absolute; top: calc(100% + 6px); right: 0; z-index: 26;
	min-width: 140px; padding: 4px; box-sizing: border-box;
	display: flex; flex-direction: column; gap: 1px;
	border-radius: 9px;
	background: var(--dsw-alias-bg-layer-1, #fff);
	border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
	box-shadow: 0 10px 28px rgba(0,0,0,.28);
}
.dsh-de-menu-item {
	display: flex; align-items: center; gap: 8px;
	height: 28px; padding: 0 8px; box-sizing: border-box;
	border: 0; border-radius: 6px; background: transparent;
	color: var(--dsw-alias-label-secondary, #6b7280);
	font: inherit; font-size: 13px; text-align: left; cursor: pointer; white-space: nowrap;
}
.dsh-de-menu-item:hover {
	background: var(--de-fill, rgba(127,127,127,.1));
	color: var(--dsw-alias-label-primary, #1f2328);
}
.dsh-de-menu-item-danger { color: var(--dsw-alias-state-error-primary, #e5484d); }
.dsh-de-menu-item-danger:hover { color: var(--dsw-alias-state-error-primary, #e5484d); }
.dsh-de-counters { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 34px; }
@media (max-width: 760px) { .dsh-de-counters { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } }
.dsh-de-statcard {
	display: flex; flex-direction: column; gap: 9px;
	padding: 18px; box-sizing: border-box;
	border-radius: 10px; background: var(--de-fill, #f0f0f0);
}
.dsh-de-statcard-label {
	font-size: 12px; line-height: 1.1;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 60%, transparent);
}
.dsh-de-statcard-value { display: flex; align-items: baseline; gap: 5px; }
.dsh-de-statcard-number {
	font-size: 20px; font-weight: 550; line-height: 1.05; letter-spacing: -.2px;
	font-variant-numeric: tabular-nums;
	color: var(--dsw-alias-label-primary, #0d0d0f);
}
.dsh-de-statcard-unit {
	font-size: 12px; line-height: 1.1;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 60%, transparent);
}
.dsh-de-exercises { margin-top: 32px; }
.dsh-de-exhead {
	padding: 0 1px 15px; font-size: 13px;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 56%, transparent);
}
.dsh-de-exlist { display: flex; flex-direction: column; }
/* Pointing at one row keeps it at full strength and dims every other row by the
   same amount: a local highlight, no movement. Keyboard focus does the same. */
.dsh-de-exrow {
	position: relative; display: flex; align-items: center; gap: 10px;
	width: 100%; min-height: 54px; padding: 0; box-sizing: border-box; border-radius: 8px;
	transition: opacity .16s ease;
}
.dsh-de-exlist:has(.dsh-de-exrow:hover) .dsh-de-exrow:not(:hover):not(:has(.dsh-de-menu[open])),
.dsh-de-exlist:focus-within .dsh-de-exrow:not(:focus-within):not(:has(.dsh-de-menu[open])) { opacity: .45; }
@media (prefers-reduced-motion: reduce) {
	.dsh-de-exrow { transition: none; }
}
.dsh-de-level {
	flex: none; min-width: 22px; height: 17px; padding: 0 3px; box-sizing: border-box;
	border-radius: 5px;
	display: inline-flex; align-items: center; justify-content: center;
	font-size: 10px; font-weight: 700; letter-spacing: .1px; color: #fff;
	background: #b281f1;
}
.dsh-de-level[data-band="B"] { background: #3bb79c; }
.dsh-de-level[data-band="C"] { background: #d0c33a; }
.dsh-de-extitle {
	margin-left: 11px; flex: 1 1 auto; min-width: 0; font-size: 15px; font-weight: 650;
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dsh-de-exstatus {
	flex: none; display: inline-flex; align-items: baseline; gap: 0;
	font-size: 14px; font-variant-numeric: tabular-nums;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 52%, transparent);
}
.dsh-de-exscore-text {
	font-size: 15px; font-weight: 600;
	color: var(--dsw-alias-state-success-primary, #16a34a);
}
.dsh-de-exstate { color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 48%, transparent); }
.dsh-de-exstate[data-state="typing"],
.dsh-de-exstate[data-state="result"] { color: #c99a00; font-weight: 500; }
.dsh-de-exsep { margin: 0 4px; color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 62%, transparent); }
.dsh-de-exprogress { color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 56%, transparent); }
.dsh-de-rowgo {
	flex: none; width: 31px; height: 31px; padding: 0; border: 0; border-radius: 50%;
	display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
	color: var(--dsw-alias-bg-base, #fff); background: var(--dsw-alias-label-primary, #17181a);
	transition: filter .12s ease, transform .12s ease;
}
.dsh-de-rowgo:hover { filter: brightness(1.2); }
.dsh-de-rowgo:active { transform: scale(.96); }
.dsh-de-rowgo:disabled { opacity: .4; cursor: default; }
.dsh-de-exempty { padding: 16px 2px; font-size: 13px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-homenotice { margin-top: 18px; }
.dsh-de-homepanel { margin-top: 22px; }

/* ── add an exercise ── */
.dsh-de-addwrap { width: 100%; max-width: calc(var(--de-page-max) + 2 * var(--de-page-inset)); margin: 0 auto; padding: 56px var(--de-page-inset) 40px; box-sizing: border-box; }
.dsh-de-addhead { display: flex; align-items: center; gap: 11px; }
.dsh-de-addhead .dsh-de-icobtn { width: 26px; height: 26px; border-radius: 50%; }
.dsh-de-addhead .dsh-de-icobtn:first-child { margin-left: -5px; }
.dsh-de-addhead .dsh-de-icobtn:last-child { margin-left: 2px; }
.dsh-de-addtitle { margin: 0; font-size: 24px; font-weight: 620; letter-spacing: -.4px; }
/* The toolbar is the one place the page asks for a decision: target level,
   then topic. It sits between the title and the time-ordered stream. */
.dsh-de-addtools {
	display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
	margin-top: 28px;
}
.dsh-de-chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1 1 auto; min-width: 0; }
.dsh-de-chip {
	display: inline-flex; align-items: center; gap: 5px;
	padding: 4px 9px; border: 1px solid transparent; border-radius: 999px;
	background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);
	font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap;
}
.dsh-de-chip:hover { color: var(--dsw-alias-label-primary, #15161c); background: var(--de-fill, rgba(127,127,127,.08)); }
.dsh-de-chip-on,
.dsh-de-chip-on:hover {
	color: var(--dsw-alias-label-primary, #15161c);
	background: var(--de-fill-strong, rgba(127, 127, 127, .14));
	border-color: transparent;
}
.dsh-de-chip-count {
	font-size: 10px; font-variant-numeric: tabular-nums;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 45%, transparent);
}
.dsh-de-srchint {
	flex: 0 1 auto; min-width: 0; margin: 0 4px 0 auto;
	font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 42%, transparent);
}
.dsh-de-addhead .dsh-de-addtitle { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 560px) {
	.dsh-de-srchint { display: none; }
	/* With the hint hidden, refresh takes over the right-alignment duty. */
	.dsh-de-addhead .dsh-de-icobtn:last-child { margin-left: auto; }
}
/* The level dialog: the one decision the page defers to a click. */
.dsh-de-modal {
	position: fixed; inset: 0; z-index: 20;
	display: flex; align-items: flex-start; justify-content: center;
	padding: 24px; box-sizing: border-box;
	overflow-y: auto;
	background: rgba(12, 13, 17, .32);
	animation: dsh-de-fade .14s ease-out;
}
.dsh-de-dialog {
	width: min(560px, 100%); max-height: none;
	margin: auto; box-sizing: border-box; padding: 26px 28px 24px;
	border-radius: 20px;
	background: var(--dsw-alias-bg-layer-1, #fff);
	color: var(--dsw-alias-label-primary, #15161c);
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
	box-shadow: 0 28px 70px rgba(0, 0, 0, .26);
	animation: dsh-de-rise .16s ease-out;
}
.dsh-de-dialog-head { display: flex; align-items: flex-start; gap: 12px; }
.dsh-de-dialog-title {
	flex: 1 1 auto; margin: 0;
	font-size: 22px; line-height: 1.25; font-weight: 680; letter-spacing: -.3px;
}
.dsh-de-dialog-close {
	flex: none; width: 30px; height: 30px; margin: -4px -6px 0 0;
	display: inline-flex; align-items: center; justify-content: center;
	border: 0; border-radius: 8px; background: transparent; cursor: pointer;
	color: var(--dsw-alias-label-secondary, #6b7280); font: inherit;
}
.dsh-de-dialog-close:hover { background: var(--de-fill, rgba(127,127,127,.08)); color: var(--dsw-alias-label-primary, #15161c); }
.dsh-de-article {
	margin-top: 18px; padding: 16px 18px; border-radius: 14px;
	background: var(--de-fill, rgba(127,127,127,.07));
}
.dsh-de-article-title { margin: 0; font-size: 15px; line-height: 1.45; font-weight: 600; }
.dsh-de-article-summary {
	margin: 8px 0 0; font-size: 13px; line-height: 1.55;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #15161c) 56%, transparent);
	display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.dsh-de-article-meta {
	margin-top: 12px; display: flex; align-items: center; gap: 8px;
	font-size: 12px;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #15161c) 58%, transparent);
}
.dsh-de-article-domain { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-de-article-meta .dsh-de-srclink { margin-left: auto; width: 24px; height: 24px; }
.dsh-de-level-heading { margin: 22px 0 0; font-size: 16px; font-weight: 650; }
.dsh-de-dialog-hint {
	margin: 6px 0 0; font-size: 13px; line-height: 1.55;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 55%, transparent);
}
.dsh-de-levelselectwrap { position: relative; margin-top: 16px; }
.dsh-de-levelselect {
	width: 100%; height: 44px; box-sizing: border-box; padding: 0 40px 0 12px;
	border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .14));
	border-radius: 10px; background: var(--de-fill, rgba(127, 127, 127, .08));
	color: var(--dsw-alias-label-primary, #15161c);
	font: inherit; font-size: 14px; cursor: pointer;
	-webkit-appearance: none; appearance: none;
}
.dsh-de-levelchevron {
	position: absolute; right: 16px; top: 50%;
	width: 7px; height: 7px; box-sizing: border-box;
	border-right: 1.5px solid var(--dsw-alias-label-secondary, #6b7280);
	border-bottom: 1.5px solid var(--dsw-alias-label-secondary, #6b7280);
	transform: translateY(-62%) rotate(45deg);
	opacity: .5; pointer-events: none;
}
.dsh-de-levelselect:focus {
	outline: none;
	border-color: var(--dsw-alias-brand-primary, #4f6bed);
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary, #4f6bed) 18%, transparent);
}
.dsh-de-levelselect:disabled { opacity: .6; cursor: default; }
.dsh-de-addopts { margin-top: 14px; }
.dsh-de-addopts summary {
	list-style: none; display: flex; align-items: center; gap: 8px;
	font-size: 13px; color: var(--dsw-alias-label-secondary, #6b7280);
	cursor: pointer; user-select: none;
}
.dsh-de-addopts summary::-webkit-details-marker { display: none; }
.dsh-de-addopts-chev {
	width: 6px; height: 6px; flex: none; box-sizing: border-box;
	border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
	transform: rotate(-45deg); opacity: .6; transition: transform .12s ease;
}
.dsh-de-addopts[open] .dsh-de-addopts-chev { transform: rotate(45deg); }
.dsh-de-addopts-body { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.dsh-de-addopts-body .dsh-de-tag-row { padding: 4px 0; }
.dsh-de-addopts-body .dsh-de-tag-name { width: 72px; }
.dsh-de-opts-select {
	flex: 1 1 auto; min-width: 0; height: 34px; padding: 0 8px; box-sizing: border-box;
	border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .14));
	border-radius: 8px; background: var(--de-fill, rgba(127, 127, 127, .08));
	color: var(--dsw-alias-label-primary, #15161c); font: inherit; font-size: 13px;
}
.dsh-de-opts-select:disabled { opacity: .55; }
.dsh-de-leveldef {
	margin: 8px 0 0; font-size: 13px; line-height: 1.6;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 68%, transparent);
}
.dsh-de-leveldef-id {
	margin-right: 6px; font-weight: 650;
	color: var(--dsw-alias-label-primary, #15161c);
}
.dsh-de-dialog-foot { display: flex; align-items: center; gap: 16px; margin-top: 20px; }
.dsh-de-dialog-note {
	flex: 1 1 auto; display: flex; align-items: center; gap: 8px; margin: 0;
	font-size: 12px;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #0d0d0f) 55%, transparent);
}
.dsh-de-checkbox {
	flex: none; width: 16px; height: 16px; box-sizing: border-box; border-radius: 50%;
	display: inline-flex; align-items: center; justify-content: center;
	background: var(--dsw-alias-label-primary, #16171a);
	color: var(--dsw-alias-bg-base, #fff);
}
.dsh-de-dialog-go {
	flex: none; padding: 12px 20px; border: 0; border-radius: 10px; cursor: pointer;
	background: var(--dsw-alias-label-primary, #16171a); color: var(--dsw-alias-bg-base, #fff);
	font: inherit; font-size: 14px; font-weight: 600;
}
.dsh-de-dialog-go:hover { filter: brightness(1.15); }
.dsh-de-dialog-go:disabled { opacity: .5; cursor: default; }
@media (max-height: 700px) {
	.dsh-de-modal { padding: 14px 24px; }
	.dsh-de-dialog { padding: 20px 22px 18px; }
	.dsh-de-dialog-title { font-size: 20px; }
	.dsh-de-article { margin-top: 14px; padding: 12px 14px; }
	.dsh-de-article-summary { margin-top: 6px; -webkit-line-clamp: 1; }
	.dsh-de-level-heading { margin-top: 16px; }
	.dsh-de-leveldef { margin-top: 8px; }
	.dsh-de-dialog-foot { margin-top: 14px; }
}
.dsh-de-voicedialog {
	width: min(520px, 100%);
	max-height: calc(100vh - 48px);
	overflow-y: auto;
}
.dsh-de-voicedialog .dsh-de-tag-row { padding: 8px 0; }
.dsh-de-voicedialog .dsh-de-secondary:disabled { opacity: .5; cursor: not-allowed; }
.dsh-de-voice-actions {
	display: flex; align-items: center; justify-content: flex-end; gap: 16px;
	margin-top: 18px; padding-top: 16px;
}
.dsh-de-voice-actions .dsh-de-secondary,
.dsh-de-voice-actions .dsh-de-dialog-go {
	display: inline-flex; align-items: center; justify-content: center;
	height: 40px; box-sizing: border-box; padding: 0 20px;
	border-radius: 10px; font-size: 14px; font-family: inherit;
}
.dsh-de-voice-actions .dsh-de-secondary { font-weight: 500; }
@media (max-height: 700px) {
	.dsh-de-voicedialog { padding: 20px 22px; }
}
@media (max-width: 560px) {
	.dsh-de-dialog { padding: 20px; border-radius: 16px; }
	.dsh-de-dialog-title { font-size: 19px; }
}
.dsh-de-searchbox {
	position: relative; display: flex; align-items: center; gap: 8px;
	width: 100%; height: 40px; box-sizing: border-box; margin-top: 22px;
	padding: 0 14px; border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .14));
	border-radius: 999px; background: transparent;
	color: var(--dsw-alias-label-secondary, #6b7280);
	transition: border-color .12s ease, box-shadow .12s ease;
}
.dsh-de-searchbox:focus-within {
	border-color: var(--dsw-alias-state-business-primary, #2f6fed);
	box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary, #2f6fed) 16%, transparent);
}
.dsh-de-searchico {
	display: inline-flex; align-items: center; justify-content: center;
	flex: none; color: var(--dsw-alias-label-secondary, #6b7280);
}
.dsh-de-searchinput {
	flex: 1; min-width: 0; height: 100%; padding: 0;
	border: 0; background: transparent; outline: none;
	color: var(--dsw-alias-label-primary, #15161c);
	font: inherit; font-size: 14px;
}
.dsh-de-searchinput::-webkit-search-cancel-button { display: none; }
.dsh-de-searchinput::placeholder { color: var(--dsw-alias-label-tertiary, #999); }
.dsh-de-searchclear {
	display: inline-flex; align-items: center; justify-content: center;
	width: 24px; height: 24px; padding: 0; flex: none;
	border: 0; border-radius: 50%; background: transparent; cursor: pointer;
	color: var(--dsw-alias-label-secondary, #6b7280);
}
.dsh-de-searchclear:hover { background: var(--de-fill, rgba(127,127,127,.14)); color: var(--dsw-alias-label-primary, #15161c); }
.dsh-de-searchclear:focus-visible { outline: 2px solid var(--dsw-alias-label-primary, #15161c); outline-offset: 1px; }
.dsh-de-searchsuggest {
	position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 9;
	padding: 4px; box-sizing: border-box; border-radius: 10px;
	background: var(--dsw-alias-bg-layer-1, #fff);
	border: .5px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3));
	box-shadow: 0 10px 28px rgba(0, 0, 0, .18);
}
.dsh-de-searchrow {
	display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px;
	padding: 0 10px; box-sizing: border-box; border: 0; border-radius: 7px;
	background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);
	font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.dsh-de-searchrow:hover { background: var(--de-fill, rgba(127,127,127,.08)); color: var(--dsw-alias-label-primary, #15161c); }
.dsh-de-searchrow:disabled { opacity: .6; cursor: default; }
.dsh-de-searchrow-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-de-searchempty { padding: 18px 0; font-size: 13px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-skrow {
	display: flex; align-items: center; gap: 18px;
	min-height: 40px; padding: 0; box-sizing: border-box;
}
.dsh-de-sk {
	flex: none; display: block; border-radius: 6px;
	background: linear-gradient(90deg, var(--de-fill, rgba(127,127,127,.08)) 25%, var(--de-fill-strong, rgba(127,127,127,.16)) 37%, var(--de-fill, rgba(127,127,127,.08)) 63%);
	background-size: 300% 100%;
	animation: dsh-de-shimmer 1.3s linear infinite;
}
.dsh-de-sk-dot { width: 16px; height: 16px; border-radius: 50%; }
.dsh-de-sk-title { height: 12px; max-width: calc(100% - 220px); }
.dsh-de-sk-meta { width: 84px; height: 10px; margin-left: auto; }
.dsh-de-sk-plus { width: 24px; height: 24px; border-radius: 50%; }
@media (prefers-reduced-motion: reduce) {
	.dsh-de-sk { animation: none; }
}
.dsh-de-addlist { margin-top: 24px; display: flex; flex-direction: column; }
.dsh-de-addrow { display: flex; align-items: center; gap: 18px; min-height: 40px; padding: 0; box-sizing: border-box; }
.dsh-de-addico {
	flex: none; width: 16px; height: 16px; box-sizing: border-box;
	border-radius: 4px; object-fit: contain;
	background: var(--de-fill, rgba(127,127,127,.08));
}
.dsh-de-unread {
	display: inline-block; width: 5px; height: 5px; margin-right: 6px;
	border-radius: 50%; vertical-align: middle;
	background: var(--dsw-alias-brand-primary, #4f6bed);
}
/* Read articles stay visible but recede, like a feed reader's read rows. */
.dsh-de-addrow[data-read="true"] .dsh-de-addrow-title {
	color: var(--dsw-alias-label-secondary, #6b7280);
}
.dsh-de-addico-fallback {
	display: inline-flex; align-items: center; justify-content: center;
	font-size: 9px; font-weight: 650; line-height: 1;
	color: var(--dsw-alias-label-secondary, #6b7280);
	text-transform: uppercase;
}
.dsh-de-addrow-title {
	flex: 0 1 auto; min-width: 0; font-size: 13px;
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* Opening the original is a hover affordance, revealed in place. */
.dsh-de-openlink {
	flex: none; display: inline-flex; align-items: center; justify-content: center;
	width: 20px; height: 20px; margin-left: -10px; box-sizing: border-box; border-radius: 6px;
	color: var(--dsw-alias-label-secondary, #6b7280); text-decoration: none;
	opacity: 0; pointer-events: none;
	transition: opacity .12s ease, background .12s ease, color .12s ease;
}
.dsh-de-openlink svg { transform: rotate(-45deg); }
.dsh-de-addrow:hover .dsh-de-openlink,
.dsh-de-addrow:focus-within .dsh-de-openlink { opacity: 1; pointer-events: auto; }
.dsh-de-openlink:hover { background: var(--de-fill, rgba(127,127,127,.08)); color: var(--dsw-alias-label-primary, #1f2328); }
@media (hover: none) {
	.dsh-de-openlink { opacity: 1; pointer-events: auto; }
}
.dsh-de-addmeta {
	flex: none; margin-left: auto; font-size: 13px; font-variant-numeric: tabular-nums;
	color: color-mix(in oklab, var(--dsw-alias-label-primary, #15161c) 50%, transparent);
}
@media (max-width: 560px) {
	.dsh-de-addmeta { font-size: 11px; }
	.dsh-de-addmeta-topic { display: none; }
}
.dsh-de-addcircle {
	flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 50%;
	display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
	color: var(--dsw-alias-label-secondary, #6b7280);
	background: var(--de-fill, #f2f2f2);
	transition: color .12s ease, filter .12s ease;
}
.dsh-de-addcircle:hover { color: var(--dsw-alias-label-primary, #15161c); filter: brightness(.96); }
.dsh-de-addcircle:disabled { cursor: default; opacity: .55; }
.dsh-de-addcircle-busy { cursor: default; }
.dsh-de-spinner {
	display: block; width: 13px; height: 13px; box-sizing: border-box;
	border: 2px solid currentColor; border-top-color: transparent; border-radius: 50%;
	animation: dsh-de-spin .8s linear infinite;
}
@keyframes dsh-de-spin { to { transform: rotate(360deg); } }
.dsh-de-adddone {
	flex: none; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;
	color: var(--dsw-alias-state-success-primary, #16a34a);
}
.dsh-de-addempty { padding: 16px 0; font-size: 13px; color: var(--dsw-alias-label-secondary, #6b7280); }

/* The toast lives in shell.overlay, on the host's overlay surface. */
.dsh-de-toast {
	position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
	z-index: 2147483000; box-sizing: border-box;
	display: flex; align-items: center; gap: 8px;
	max-width: min(560px, calc(100vw - 32px));
	padding: 9px 14px; border-radius: 10px;
	border: .5px solid var(--dsw-alias-border-l2, rgba(0,0,0,.14));
	background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #fff));
	color: var(--dsw-alias-label-primary, #111);
	box-shadow: 0 8px 28px rgba(0, 0, 0, .22);
	font-size: 13px; line-height: 1.4;
	cursor: default;
	animation: dsh-de-toast-in .16s ease-out;
}
.dsh-de-toast-icon { display: inline-flex; flex: none; color: var(--dsw-alias-state-success-primary, #16a34a); }
.dsh-de-toast-warning {
	width: 15px; height: 15px; border-radius: 50%;
	align-items: center; justify-content: center;
	font-size: 10px; font-weight: 700; line-height: 1;
	background: var(--dsw-alias-state-warning-primary, #d97706);
	color: var(--dsw-alias-bg-base, #fff);
}
.dsh-de-toast-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes dsh-de-toast-in { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
.dsh-de-addmore {
	align-self: flex-end; margin: 27px 9px 0 0; padding: 2px 0; border: 0; border-radius: 6px;
	background: transparent; color: var(--dsw-alias-label-primary, #15161c);
	font: inherit; font-size: 13px; cursor: pointer;
}
.dsh-de-addmore:hover { text-decoration: underline; text-underline-offset: 3px; }
.dsh-de-group {
	display: flex; flex-direction: column; align-items: center; gap: 8px;
	padding: 22px 18px 12px; border-radius: 16px;
	border: 1.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,.16));
	background: var(--dsw-alias-bg-layer-1, #fff);
	position: relative; max-width: 100%;
}
.dsh-de-group-role {
	position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
	padding: 2px 10px; border-radius: 999px;
	background: var(--dsw-alias-brand-primary, #4f6bed); color: #fff;
	font-size: 11px; font-weight: 600; letter-spacing: .4px; white-space: nowrap;
}
.dsh-de-wordcell { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.dsh-de-annot { display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 30px; }
.dsh-de-wordzh { font-size: 13px; color: var(--dsw-alias-label-primary, #1f2328); text-align: center; }
.dsh-de-wordpos { font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-punct {
	align-self: flex-end; padding: 0 .1ch 8px .1ch;
	font-size: .85em; line-height: 1.4;
	color: var(--dsw-alias-label-secondary, #6b7280);
}
.dsh-de-wc-role {
	font-size: 11px; font-weight: 650; letter-spacing: .5px;
	color: var(--dsw-alias-brand-primary, #4f6bed);
}
.dsh-de-answer-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; width: 100%; }
.dsh-de-answer-form { display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%; }
.dsh-de-boxes {
	display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: center;
	gap: 2px 1ch;
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	letter-spacing: 0; line-height: 1.4;
}
.dsh-de-boxes .dsh-de-box {
	box-sizing: border-box; margin: 0; padding: 2px 0 8px;
	-webkit-appearance: none; appearance: none;
	border: 0; border-bottom: 2px solid var(--dsw-alias-border-l2, rgba(0,0,0,.18));
	border-radius: 0; background: transparent;
	color: var(--dsw-alias-label-primary, #1f2328);
	font: inherit; text-align: center; outline: none;
	transition: color .12s ease, border-color .12s ease;
}
.dsh-de-boxes .dsh-de-box:focus {
	color: var(--dsw-alias-brand-primary, #4f6bed);
	border-bottom-color: var(--dsw-alias-brand-primary, #4f6bed);
}
.dsh-de-boxes .dsh-de-box[data-state="wrong"] {
	color: var(--dsw-alias-state-error-primary, #dc2626);
	border-bottom-color: var(--dsw-alias-state-error-primary, #dc2626);
}
.dsh-de-topbar-name {
	font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-secondary, #6b7280);
	max-width: 46vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dsh-de-topbar-actions {
	margin-left: auto; display: flex; align-items: center; gap: 6px;
	color: var(--dsw-alias-label-secondary, #6b7280); font-size: 12px;
}
.dsh-de-timer-wrap {
	display: inline-flex; align-items: center; gap: 6px;
	transition: opacity .15s ease;
}
.dsh-de-timer-wrap[data-paused="true"] { opacity: .5; }
.dsh-de-timer { font-variant-numeric: tabular-nums; letter-spacing: .4px; }
.dsh-de-srclink {
	flex: none; display: inline-flex; align-items: center; justify-content: center;
	width: 20px; height: 20px; border-radius: 6px;
	color: var(--dsw-alias-label-secondary, #6b7280); text-decoration: none;
	transition: background .12s ease, color .12s ease;
}
.dsh-de-srclink svg { transform: rotate(-45deg); }
.dsh-de-srclink:hover { background: var(--de-fill, rgba(127,127,127,.08)); color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-badge {
	display: inline-flex; align-items: center; justify-content: center;
	min-width: 26px; padding: 1px 6px; border-radius: 6px;
	background: rgba(120, 120, 120, .9); color: #fff;
	font-size: 10px; font-weight: 650; letter-spacing: .4px;
}
.dsh-de-retry {
	display: inline-flex; align-items: center; gap: 4px;
	border: 0; background: transparent; color: var(--dsw-alias-label-secondary, #6b7280);
	font: inherit; font-size: 12px; cursor: pointer; padding: 2px 4px;
}
.dsh-de-practice-stage { padding: 0; justify-content: flex-start; overflow-x: hidden; }
.dsh-de-practice-main {
	position: relative; z-index: 1;
	flex: 1 1 auto; min-height: 0; width: 100%; box-sizing: border-box;
	display: flex; flex-direction: column; align-items: center; justify-content: center;
	gap: 18px; padding: 24px 20px;
}
.dsh-de-practice-footer {
	position: relative; z-index: 1;
	flex: 0 0 auto; display: grid; grid-template-columns: 120px minmax(0, 1fr) 120px;
	align-items: center; width: 100%; box-sizing: border-box;
	gap: 12px; padding: 8px 24px 16px;
	color: var(--dsw-alias-label-secondary, #6b7280); font-size: 12px;
}
/* The sound-reactive glow: four blurred colour fields at the bottom of the
   practice page, behind the content. --de-glow (0..1) is written by the page
   from the analyser (or a synthetic pulse) and drives how far they rise and how
   bright they are; the drift animations run on their own slower clock. */
.dsh-de-glow {
	position: absolute; left: 0; right: 0; bottom: 0; height: 42%; min-height: 180px; max-height: 380px;
	z-index: 0; overflow: hidden; pointer-events: none;
	opacity: 0; transition: opacity .45s ease;
	--de-glow: 0;
	/* Seed colours: violet, teal and yellow, with a blended bridge. */
	--de-glow-a: #a365f2;
	--de-glow-b: #45ceb1;
	--de-glow-c: #dacf5c;
	--de-glow-mix: #749ad2;
	/* Fade the top of the whole glow, so the blurred fields never end on a
	   hard horizontal line where the container clips them. */
	-webkit-mask-image: linear-gradient(to top, #000 0%, #000 52%, transparent 96%);
	mask-image: linear-gradient(to top, #000 0%, #000 52%, transparent 96%);
}
.dsh-de-glow-on { opacity: 1; }
.dsh-de-glow::after {
	content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 42%;
	background: linear-gradient(
		90deg,
		color-mix(in srgb, var(--de-glow-a) 26%, transparent),
		color-mix(in srgb, var(--de-glow-mix) 24%, transparent),
		color-mix(in srgb, var(--de-glow-b) 22%, transparent),
		color-mix(in srgb, var(--de-glow-c) 20%, transparent)
	);
	filter: blur(30px);
	opacity: calc(.22 + var(--de-glow) * .42);
	transform: scaleY(calc(.75 + var(--de-glow) * .45));
	transform-origin: bottom center;
	transition: transform .18s ease-out, opacity .18s ease-out;
}
.dsh-de-glow span {
	position: absolute; display: block; border-radius: 50%;
	filter: blur(56px);
	transform: translate3d(0, calc((1 - var(--de-glow)) * 26%), 0) scale(calc(.94 + var(--de-glow) * .4));
	opacity: calc(.28 + var(--de-glow) * .42);
	transition: transform .18s ease-out, opacity .18s ease-out;
	will-change: transform, opacity;
}
.dsh-de-glow-a {
	left: -12%; bottom: -35%; width: 62%; height: 135%;
	background: radial-gradient(circle at 50% 60%, color-mix(in srgb, var(--de-glow-a) 90%, transparent), transparent 68%);
	animation: dsh-de-glow-a 7.5s ease-in-out infinite alternate;
}
.dsh-de-glow-b {
	left: 20%; bottom: -45%; width: 70%; height: 145%;
	background: radial-gradient(circle at 50% 60%, color-mix(in srgb, var(--de-glow-mix) 85%, transparent), transparent 68%);
	animation: dsh-de-glow-b 9.5s ease-in-out infinite alternate;
}
.dsh-de-glow-c {
	right: -14%; bottom: -38%; width: 58%; height: 130%;
	background: radial-gradient(circle at 50% 60%, color-mix(in srgb, var(--de-glow-b) 80%, transparent), transparent 68%);
	animation: dsh-de-glow-c 8.5s ease-in-out infinite alternate;
}
.dsh-de-glow-d {
	left: 38%; bottom: -52%; width: 46%; height: 115%;
	background: radial-gradient(circle at 50% 60%, color-mix(in srgb, var(--de-glow-c) 65%, transparent), transparent 70%);
	animation: dsh-de-glow-d 11s ease-in-out infinite alternate;
}
@keyframes dsh-de-glow-a { from { translate: -3% 2%; } to { translate: 5% -4%; } }
@keyframes dsh-de-glow-b { from { translate: 4% -2%; } to { translate: -5% 3%; } }
@keyframes dsh-de-glow-c { from { translate: -2% -3%; } to { translate: 4% 4%; } }
@keyframes dsh-de-glow-d { from { translate: 2% 3%; } to { translate: -4% -5%; } }
@media (prefers-reduced-motion: reduce) {
	.dsh-de-glow span { animation: none; transition: none; transform: none; }
	.dsh-de-glow { transition: none; }
}
.dsh-de-footer-audio {
	display: inline-flex; align-items: center; gap: 8px;
	border: 0; border-radius: 8px; background: transparent; color: inherit;
	font: inherit; padding: 4px 8px; cursor: pointer;
}
.dsh-de-footer-audio:hover { background: var(--de-fill, rgba(127, 127, 127, .08)); }
.dsh-de-footer-left { display: flex; align-items: center; justify-content: flex-start; gap: 0; width: 100%; }
.dsh-de-footer-speed {
	border: 0; border-radius: 7px; background: transparent; color: inherit;
	font: inherit; font-size: 12px; font-variant-numeric: tabular-nums;
	padding: 3px 5px; cursor: pointer; line-height: 1.4;
	-webkit-appearance: none; appearance: none; background-image: none;
}
.dsh-de-footer-speed:hover { background: var(--de-fill, rgba(127, 127, 127, .08)); }
.dsh-de-footer-speed::-ms-expand { display: none; }
.dsh-de-footer-hint { min-width: 0; text-align: center; padding: 0 12px; line-height: 1.5; opacity: .7; }
.dsh-de-footer-hint kbd {
	display: inline-block; padding: 0 4px;
	border: 1px solid rgba(127, 127, 127, .28); border-radius: 4px;
	background: transparent; font: inherit; font-size: 11px; line-height: 1.4;
}
.dsh-de-footer-count { display: flex; align-items: center; justify-content: flex-end; width: 100%; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dsh-de-article-sentence {
	position: relative; width: 100%; max-width: 80%; margin: 0 auto;
	display: flex; flex-direction: column; align-items: center; gap: 18px;
}
.dsh-de-listen { display: flex; flex-direction: column; align-items: center; gap: 10px; width: 100%; text-align: center; padding: 20px; box-sizing: border-box; }
.dsh-de-listen-translation { max-width: 90%; font-size: 30px; line-height: 1.5; text-align: center; color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-sentence-result {
	display: flex; flex-direction: column; align-items: center; gap: 20px;
	width: 100%; max-width: 80%; margin: 0 auto; padding: 10px 0;
}
.dsh-de-result-grid {
	display: flex; flex-wrap: wrap; justify-content: center;
	gap: 12px 6px; max-width: 900px; align-items: flex-end;
}
.dsh-de-result-item { display: inline-flex; flex-direction: column; align-items: center; gap: 3px; }
.dsh-de-result-count {
	font-size: 9px; letter-spacing: .4px;
	color: var(--dsw-alias-label-secondary, #6b7280);
}
.dsh-de-result-body { display: inline-flex; align-items: center; gap: 2px; }
.dsh-de-result-chip {
	display: inline-block; padding: 2px 8px 3px; border-radius: 8px;
	font-size: 30px; line-height: 1.25;
	color: #1f2328;
}
.dsh-de-result-chip,
.dsh-de-result-punct,
.dsh-de-result-given {
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.dsh-de-result-chip[data-tone="good"] { background: #e3f4e6; }
.dsh-de-result-chip[data-tone="warn"] { background: #fbecc9; color: #1f2328; }
.dsh-de-result-punct { font-size: 30px; line-height: 1.25; padding: 2px 0 3px; color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-result-given { font-size: 30px; line-height: 1.25; color: var(--dsw-alias-label-primary, #1f2328); padding: 2px 8px 3px; }
.dsh-de-boxwrap { position: relative; display: inline-flex; align-items: flex-end; }
.dsh-de-dotlayer {
	position: absolute; left: 0; right: 0; top: 2px; bottom: 8px;
	display: flex; align-items: center; justify-content: center;
	pointer-events: none; z-index: 0;
}
.dsh-de-dot { width: 1ch; display: flex; align-items: center; justify-content: center; }
.dsh-de-dotlayer { color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-dot::before {
	content: ''; width: 2px; height: 2px; border-radius: 50%;
	background: currentColor;
	opacity: .1; transition: opacity .1s ease;
}
.dsh-de-dot[data-hidden="true"]::before { opacity: 0; }
.dsh-de-dotlayer[data-peek="true"] { opacity: 0; }
.dsh-de-given {
	color: var(--dsw-alias-label-primary, #1f2328);
	/* Same box as a dictation input: the bottom rule is transparent, but the
	   padding + line box keep the baseline and cap height on the same line. */
	display: inline-block;
	box-sizing: border-box;
	padding: 2px 0 8px;
	border-bottom: 2px solid transparent;
	line-height: 1.4;
	font-size: inherit;
}
/* Long-press ↑: the input is replaced in place by its word; its bottom rule
   rises above the word while the word scrolls up from the input. */
.dsh-de-peek-inplace {
	position: absolute; left: 0; right: 0; bottom: 8px;
	display: flex; justify-content: center; pointer-events: none; z-index: 5;
}
.dsh-de-peek-inplace-inner { position: relative; display: inline-block; }
.dsh-de-peek-inplace-word {
	display: block; font: inherit; line-height: 1.4; white-space: nowrap;
	color: var(--dsw-alias-label-primary, #1f2328);
	animation: dsh-de-peek-inplace-word 160ms cubic-bezier(.2,.8,.2,1) both;
}
.dsh-de-peek-inplace-line {
	position: absolute; left: 0; right: 0; height: 2px; border-radius: 2px;
	background: var(--dsw-alias-label-primary, #1f2328);
	animation: dsh-de-peek-inplace-line 200ms cubic-bezier(.2,.8,.2,1) both;
}
@keyframes dsh-de-peek-inplace-word {
	from { opacity: 0; transform: translateY(55%); }
	to { opacity: 1; transform: translateY(0); }
}
@keyframes dsh-de-peek-inplace-line {
	from { bottom: -2px; opacity: .35; }
	to { bottom: calc(100% + 3px); opacity: 1; }
}

.dsh-de-result-zh {
	font-size: 15px; line-height: 1.6; text-align: center;
	color: var(--dsw-alias-label-secondary, #6b7280); max-width: 820px;
}
.dsh-de-summary-body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 40px 20px 28px; }
.dsh-de-summary-inner { width: 82%; min-width: 360px; max-width: 900px; margin: 0 auto; box-sizing: border-box; }
.dsh-de-score-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.dsh-de-score-left { min-width: 0; }
.dsh-de-score-title { display: flex; align-items: center; gap: 2px; font-size: 14px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-score-help { font-size: 12px; color: var(--dsw-alias-label-tertiary, #9ca3af); cursor: help; }
.dsh-de-score-big { margin-top: 8px; font-size: 48px; line-height: 1; font-weight: 650; font-variant-numeric: tabular-nums; }
.dsh-de-score-right { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; text-align: right; font-size: 14px; color: var(--dsw-alias-label-secondary, #6b7280); white-space: nowrap; }
.dsh-de-summary-text {
	display: flex; flex-wrap: wrap; align-items: center; gap: 0.25em;
	margin-top: 28px; font-size: 16px; line-height: 1.6;
}
.dsh-de-summary-word { display: inline-flex; align-items: center; }
.dsh-de-summary-given {
	display: inline-flex; align-items: center;
	padding: 0 0.4em; border-radius: 4px;
	background: rgba(127, 127, 127, .10);
	color: var(--dsw-alias-label-primary, #1f2328);
}
.dsh-de-summary-chip {
	display: inline-block; padding: 2px 4px; border-radius: 4px;
	color: #1f2328; line-height: 1.4;
}
.dsh-de-summary-chip[data-tone="good"] { background: #e3f4e6; }
.dsh-de-summary-chip[data-tone="warn"] { background: #fbecc9; }
.dsh-de-summary-punct { color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-summary-zh {
	margin-top: 16px; font-size: 14px; line-height: 1.8;
	color: var(--dsw-alias-label-secondary, #6b7280);
}
.dsh-de-summary-divider {
	border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .08));
	margin: 20px 0 18px;
}
.dsh-de-summary-footer {
	display: flex; align-items: center; justify-content: space-between; gap: 16px;
	margin-top: 20px; padding-top: 0;
	font-size: 14px; color: var(--dsw-alias-label-secondary, #6b7280);
}
.dsh-de-summary-stat { display: inline-flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-primary, #15161c); }
.dsh-de-summary-retry {
	display: inline-flex; align-items: center; gap: 6px;
	padding: 10px 16px; border: 0; border-radius: 10px; cursor: pointer;
	background: var(--dsw-alias-label-primary, #16171a);
	color: var(--dsw-alias-bg-base, #fff);
	font: inherit; font-size: 13px; font-weight: 600;
}
.dsh-de-summary-retry:hover { filter: brightness(1.15); }
/* The answer floats over the page: one block per word with IPA, the word, an
   accent line, the grammar/meaning line and the part of speech. */
.dsh-de-reveal-overlay {
	position: fixed; inset: 0; z-index: 60;
	display: flex; align-items: center; justify-content: center;
	padding: 24px;
	background: rgba(10, 12, 18, .5);
}
.dsh-de-reveal-card {
	position: relative; box-sizing: border-box;
	max-width: min(92vw, 760px); max-height: 86vh; overflow: auto;
	padding: 28px 24px 16px;
	border-radius: 20px;
	background: var(--dsw-alias-bg-layer-1, #fff);
	border: 1.5px solid var(--dsw-alias-border-l2, rgba(0,0,0,.16));
	box-shadow: 0 24px 70px rgba(0,0,0,.35);
	animation: dsh-de-rise .16s ease;
}
.dsh-de-reveal-tag {
	position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
	padding: 3px 12px; border-radius: 999px;
	background: var(--dsw-alias-state-error-primary, #e11d48); color: #fff;
	font-size: 12px; font-weight: 650; letter-spacing: .5px; white-space: nowrap;
}
.dsh-de-reveal-words { display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 20px 30px; }
.dsh-de-rw { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 84px; max-width: 240px; }
.dsh-de-rw-ipa { font-size: 13px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-rw-word { font-size: 34px; font-weight: 650; line-height: 1.1; letter-spacing: .5px; color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-rw-accent { width: 86%; height: 3px; border-radius: 2px; margin: 2px 0 5px; }
.dsh-de-rw-gloss { font-size: 14px; line-height: 1.5; text-align: center; color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-rw-pos { font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-reveal-gloss { margin-top: 12px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-reveal-hint { margin-top: 14px; text-align: center; font-size: 12px; color: var(--dsw-alias-label-secondary, #9ca3af); }
.dsh-de-form-hint { font-size: 12px; color: var(--dsw-alias-state-warn-primary, #b45309); text-align: center; }
.dsh-de-shortcuts {
	display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px;
	font-size: 11px; color: var(--dsw-alias-label-secondary, #6b7280);
}
/* The accepted phrase is a result display, not a field: no border, no field
   background — just the status, the word and its gloss on the page. */
.dsh-de-wordcard {
	width: min(100%, 520px); box-sizing: border-box;
	padding: 4px 0 8px; border: 0; border-radius: 0; background: transparent;
	outline: none;
	display: flex; flex-direction: column; align-items: center; gap: 6px;
	text-align: center; animation: dsh-de-rise .18s ease;
}
.dsh-de-wc-status {
	font-size: 12px; font-weight: 600; letter-spacing: .4px;
	color: var(--dsw-alias-state-success-primary, #16a34a);
}
.dsh-de-wc-ipa { font-size: 15px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-wc-word { font-size: 44px; font-weight: 650; line-height: 1.12; letter-spacing: .5px; color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-wc-accent { width: min(70%, 260px); height: 4px; border-radius: 2px; margin: 6px 0 8px; background: var(--dsw-alias-state-error-primary, #e04b4b); }
.dsh-de-wc-pos { font-size: 13px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-wc-hint { margin-top: 4px; font-size: 12px; color: var(--dsw-alias-label-secondary, #9ca3af); }
.dsh-de-wc-hint kbd {
	font-family: inherit; font-size: 10px; padding: 1px 5px; border-radius: 5px;
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.16));
	background: var(--de-fill, rgba(127,127,127,.08));
}
.dsh-de-wc-zh { font-size: 20px; color: var(--dsw-alias-label-primary, #1f2328); margin-top: 10px; }
.dsh-de-shortcuts kbd {
	font-family: inherit; font-size: 10px; padding: 1px 5px; border-radius: 5px;
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.16));
	background: var(--de-fill, rgba(127,127,127,.08));
}
.dsh-de-enter-now { color: var(--dsw-alias-brand-primary, #4f6bed); }
.dsh-de-stage-label {
	font-size: 12px; letter-spacing: .3px;
	color: var(--dsw-alias-label-secondary, #6b7280);
	font-variant-numeric: tabular-nums;
	text-align: center;
}

/* The way out when a word will not come: always visible, plus a louder panel
   after a silence. */
.dsh-de-ghosts { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }
.dsh-de-ghost {
	display: inline-flex; align-items: center; gap: 6px;
	padding: 5px 10px; border-radius: 8px; cursor: pointer;
	font-family: inherit; font-size: 12px;
	color: var(--dsw-alias-label-secondary, #6b7280);
	background: transparent; border: 1px dashed var(--dsw-alias-border-l2, rgba(0,0,0,.16));
}
.dsh-de-ghost:hover { color: var(--dsw-alias-label-primary, #1f2328); border-style: solid; }
.dsh-de-ghost kbd {
	font-family: inherit; font-size: 10px; padding: 0 4px; border-radius: 4px;
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.16));
	background: var(--de-fill, rgba(127,127,127,.08));
}
.dsh-de-center {
	position: relative; width: 100%; max-width: 780px; margin: 0 auto;
	display: flex; flex-direction: column; align-items: center; gap: 18px;
}

/* feedback */
.dsh-de-feedback {
	width: 100%; max-width: 780px; margin: 0 auto;
	border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
	border-radius: 16px; overflow: hidden;
	background: var(--dsw-alias-bg-layer-1, #fff);
	box-shadow: 0 14px 40px rgba(15, 23, 42, .08);
	animation: dsh-de-rise .18s ease;
}
.dsh-de-fb-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 14px 18px 6px; }
.dsh-de-fb-result { font-size: 16px; font-weight: 700; letter-spacing: .2px; }
.dsh-de-fb-result[data-kind="perfect"] { color: var(--dsw-alias-state-success-primary, #16a34a); }
.dsh-de-fb-result[data-kind="great"] { color: var(--dsw-alias-brand-primary, #4f6bed); }
.dsh-de-fb-result[data-kind="pass"] { color: var(--dsw-alias-state-warn-primary, #b45309); }
.dsh-de-fb-result[data-kind="reveal"] { color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-fb-meta { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary, #6b7280); font-variant-numeric: tabular-nums; }
.dsh-de-sentence { display: flex; flex-wrap: wrap; gap: 4px 8px; padding: 6px 18px 10px; font-size: 18px; line-height: 1.9; }
.dsh-de-word { display: inline-flex; flex-direction: column; align-items: center; }
.dsh-de-wordtext { font-weight: 550; }
.dsh-de-wordtext[data-pos="pron"] { color: #c2418d; color: color-mix(in oklab, var(--dsw-alias-label-primary, #1f2328) 40%, #d6469b); }
.dsh-de-wordtext[data-pos="verb"] { color: #6d4bd8; color: color-mix(in oklab, var(--dsw-alias-label-primary, #1f2328) 40%, #7c5cff); }
.dsh-de-wordtext[data-pos="noun"] { color: #2f6fd0; color: color-mix(in oklab, var(--dsw-alias-label-primary, #1f2328) 40%, #3b82f6); }
.dsh-de-wordtext[data-pos="adj"] { color: #b77508; color: color-mix(in oklab, var(--dsw-alias-label-primary, #1f2328) 40%, #d97706); }
.dsh-de-wordtext[data-pos="adv"] { color: #0b7f86; color: color-mix(in oklab, var(--dsw-alias-label-primary, #1f2328) 40%, #0891b2); }
.dsh-de-wordtext[data-pos="prep"] { color: #167c5a; color: color-mix(in oklab, var(--dsw-alias-label-primary, #1f2328) 40%, #059669); }
.dsh-de-wordtext[data-pos="conj"] { color: #8b5cf6; color: color-mix(in oklab, var(--dsw-alias-label-primary, #1f2328) 42%, #a78bfa); }
.dsh-de-wordtext[data-pos="det"] { color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-wordtext[data-pos="num"] { color: #b45309; color: color-mix(in oklab, var(--dsw-alias-label-primary, #1f2328) 40%, #f59e0b); }
.dsh-de-ipa { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 10px; line-height: 1.2; color: var(--dsw-alias-label-secondary, #9ca3af); letter-spacing: .2px; }
.dsh-de-fb-review { border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); padding: 12px 18px; display: flex; flex-direction: column; gap: 6px; }
.dsh-de-review-label { font-size: 11px; letter-spacing: .5px; text-transform: uppercase; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-verdict { font-size: 15px; font-weight: 600; }
.dsh-de-detail { font-size: 13px; color: var(--dsw-alias-label-secondary, #6b7280); }
.dsh-de-review-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-de-skeleton { height: 10px; border-radius: 6px; background: linear-gradient(90deg, var(--de-fill, rgba(127,127,127,.12)) 25%, var(--de-fill-strong, rgba(127,127,127,.22)) 37%, var(--de-fill, rgba(127,127,127,.12)) 63%); background-size: 300% 100%; animation: dsh-de-shimmer 1.3s linear infinite; }
.dsh-de-report { display: flex; flex-direction: column; gap: 4px; max-height: 220px; overflow: auto; }
.dsh-de-report-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 3px 0; font-size: 13px; }
.dsh-de-report-word { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--dsw-alias-label-primary, #1f2328); }
.dsh-de-report-mark { font-size: 12px; font-weight: 650; }
.dsh-de-report-mark[data-tone="good"] { color: var(--dsw-alias-state-success-primary, #16a34a); }
.dsh-de-report-mark[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary, #b45309); }
.dsh-de-fb-actions { display: flex; align-items: center; gap: 12px; padding: 12px 18px 16px; }
.dsh-de-continue {
	display: inline-flex; align-items: center; justify-content: center; gap: 8px;
	padding: 10px 22px; border-radius: 10px; cursor: pointer;
	font-size: 15px; font-weight: 600; font-family: inherit;
	color: #fff; background: var(--dsw-alias-brand-primary, #4f6bed); border: 1px solid transparent;
}
.dsh-de-continue:disabled { opacity: .5; cursor: default; }
.dsh-de-continue-hint { font-size: 11px; opacity: .8; font-weight: 500; }
.dsh-de-error { color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 13px; }

@keyframes dsh-de-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
@keyframes dsh-de-pulse { 0%, 100% { box-shadow: 0 8px 22px color-mix(in oklab, var(--dsw-alias-brand-primary, #4f6bed) 22%, transparent); } 50% { box-shadow: 0 8px 30px color-mix(in oklab, var(--dsw-alias-brand-primary, #4f6bed) 46%, transparent); } }
@keyframes dsh-de-wave { 0%, 100% { transform: scaleY(.45); } 50% { transform: scaleY(1); } }
@keyframes dsh-de-shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
@keyframes dsh-de-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes dsh-de-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
	.dsh-de-play[data-speaking="true"], .dsh-de-wave[data-speaking="true"] i,
	.dsh-de-peek-inplace-word, .dsh-de-peek-inplace-line,
	.dsh-de-skeleton, .dsh-de-feedback, .dsh-de-reveal-card { animation: none; }
}
`

		/** Inject the stylesheet once. */
		function injectStyle() {
			if (typeof document === 'undefined' || !document.head) return
			if (document.querySelector(`style[${STYLE_ATTR}]`)) return
			const tag = document.createElement('style')
			tag.setAttribute(STYLE_ATTR, '')
			tag.textContent = CSS
			document.head.appendChild(tag)
		}

		/* ───────────────────────────── Toast ───────────────────────────── */

		/** How long a toast stays on screen. */
		const TOAST_MS = 2800

		/**
		 * The plugin's toast.
		 *
		 * DSH renders its own notices on the `shell.overlay` layer and does not
		 * expose the Toast primitive to a lazy-CJS bundle, so this host publishes
		 * the same surface: a bottom-centre pill in the overlay layer, using the
		 * host's overlay/label tokens, dismissed by itself after ~2.8 s or by a
		 * click. The store lives outside React so a toast survives a page remount
		 * (the add page is a keyed slot that unmounts on a tab switch).
		 */
		let toastState = { seq: 0, text: '', tone: 'plain' }
		const toastListeners = new Set()
		let toastTimer = null

		/** Wake every subscribed host; one bad listener must not skip the rest. */
		function emitToast() {
			for (const listener of [...toastListeners]) {
				try {
					listener()
				} catch (error) {
					/* a listener is presentation only */
				}
			}
		}

		/** Hide the current toast and stop its dismiss clock. */
		function dismissToast() {
			if (toastTimer !== null) {
				clearTimeout(toastTimer)
				toastTimer = null
			}
			if (toastState.text === '') return
			toastState = { ...toastState, text: '' }
			emitToast()
		}

		/**
		 * Show one toast; a second call replaces the first and restarts the clock.
		 * @param {string} text - already localized line.
		 * @param {'plain'|'success'} [tone] - visual tone.
		 * @returns {void}
		 */
		function showToast(text, tone = 'plain') {
			const line = String(text ?? '').trim()
			if (line === '') return
			toastState = { seq: toastState.seq + 1, text: line, tone: tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'plain' }
			emitToast()
			if (toastTimer !== null) clearTimeout(toastTimer)
			toastTimer = setTimeout(() => {
				toastTimer = null
				dismissToast()
			}, TOAST_MS)
		}

		function subscribeToast(listener) {
			toastListeners.add(listener)
			return () => toastListeners.delete(listener)
		}

		function toastSnapshot() {
			return toastState
		}

		/**
		 * The `shell.overlay` entry that renders the toast.
		 * @returns {Function} toast component.
		 */
		function makeToast() {
			return function DictationToast() {
				const state = useSyncExternalStore(subscribeToast, toastSnapshot, toastSnapshot)
				if (state.text === '') return null
				return h(
					'div',
					{
						className: 'dsh-de-toast',
						'data-tone': state.tone,
						role: 'status',
						'aria-live': 'polite',
						onClick: dismissToast,
					},
					state.tone === 'success'
						? h('span', { className: 'dsh-de-toast-icon' }, h(CheckGlyph, { size: 15 }))
						: state.tone === 'warning'
							? h('span', { className: 'dsh-de-toast-icon dsh-de-toast-warning', 'aria-hidden': 'true' }, '!')
							: null,
					h('span', { className: 'dsh-de-toast-text' }, state.text),
				)
			}
		}

		/* ───────────────────────────── Shared bits ───────────────────────────── */

		/** The left-sidebar icon: a sound wave plus a text caret. */
		function makePanelIcon() {
			return function DictationPanelIcon(props) {
				const size = props && typeof props.size === 'number' ? props.size : 16
				return h(
					'svg',
					{
						width: size,
						height: size,
						viewBox: '0 0 24 24',
						fill: 'none',
						stroke: 'currentColor',
						strokeWidth: 1.8,
						strokeLinecap: 'round',
						'aria-hidden': 'true',
						style: { flex: 'none', display: 'block' },
					},
					h('path', { d: 'M3.4 9.4v5.2' }),
					h('path', { d: 'M6.9 6.4v11.2' }),
					h('path', { d: 'M10.4 8.3v7.4' }),
					h('path', { d: 'M13.9 10.4v3.2' }),
					h('path', { d: 'M18.4 5.4v13.2' }),
					h('path', { d: 'M16.7 5.4h3.4' }),
					h('path', { d: 'M16.7 18.6h3.4' }),
				)
			}
		}

		/** The sound-wave button content. */
		function Wave(props) {
			const speaking = props && props.speaking === true
			const bars = [8, 15, 11, 19, 13]
			return h(
				'span',
				{ className: 'dsh-de-wave', 'data-speaking': speaking ? 'true' : 'false' },
				bars.map((height, index) => h('i', { key: index, style: { height: `${height}px` } })),
			)
		}

		/**
		 * The 16×16 clock from the workspace icon library (`.icons.json`), inlined so
		 * `currentColor` follows the chip. It has no paint of its own.
		 */
		function ClockGlyph() {
			return h(
				'svg',
				{
					width: 13,
					height: 13,
					viewBox: '0 0 16 16',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': 'true',
					style: { flex: 'none', display: 'block' },
				},
				h('path', { d: 'M3.25 13.75 V8.5 A4.75 4.75 0 0 1 12.75 8.5 V13.75 Z' }),
				h('line', { x1: 2, y1: 13.75, x2: 14, y2: 13.75 }),
				h('path', { d: 'M8 6 L8 8.75 L9.75 9.75' }),
			)
		}

		/** The workspace's <back> icon, inline so currentColor reaches the path. */
		function BackGlyph() {
			return h(
				'svg',
				{
					width: 16,
					height: 16,
					viewBox: '0 0 16 16',
					'aria-hidden': 'true',
					style: { flex: 'none', display: 'block' },
				},
				h('path', {
					d: 'M14.0001 7.33333H4.27612L7.80479 3.80467L6.86212 2.862L1.72412 8L6.86212 13.138L7.80479 12.1953L4.27612 8.66667H14.0001V7.33333Z',
					fill: 'currentColor',
				}),
			)
		}

		/** The workspace <search> mark, for the article-list filter. */
		function SearchGlyph(props) {
			const size = props && Number(props.size) > 0 ? Number(props.size) : 14
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', style: { flex: 'none', display: 'block' } },
				h(
					'g',
					{ stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' },
					h('circle', { cx: 7, cy: 7, r: 4.5, fill: 'none' }),
					h('line', { x1: 10.4, y1: 10.4, x2: 14, y2: 14 }),
				),
			)
		}

		function CloseGlyph() {
			return h(
				'svg',
				{ width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', style: { flex: 'none', display: 'block' } },
				h('g', { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }, h('path', { d: 'M4 4l8 8M12 4l-8 8' })),
			)
		}

		/*
		 * The workspace icon library has <back>, <check>, <close> and the rest of
		 * the page glyphs, but no plus / arrow-right / more / refresh. These four
		 * are the standard stroke shapes from the design (Feather geometry, MIT),
		 * inlined like every other glyph here so currentColor reaches them.
		 */

		/** A plus: "add", both in the header button and on an article row. */
		function PlusGlyph(props) {
			const size = props && Number(props.size) > 0 ? Number(props.size) : 14
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 24 24',
					fill: 'none',
					'aria-hidden': 'true',
					style: { flex: 'none', display: 'block' },
				},
				h('g', { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }, h('path', { d: 'M12 5v14M5 12h14' })),
			)
		}

		/** A right arrow: opens the exercise on that row. */
		function ArrowRightGlyph(props) {
			const size = props && Number(props.size) > 0 ? Number(props.size) : 12
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 24 24',
					fill: 'none',
					'aria-hidden': 'true',
					style: { flex: 'none', display: 'block' },
				},
				h('g', { stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }, [
					h('path', { key: 'shaft', d: 'M4 12h15' }),
					h('path', { key: 'head', d: 'M13 6l6 6-6 6' }),
				]),
			)
		}

		/** Three dots: the row and header overflow menus. */
		function MoreGlyph(props) {
			const size = props && Number(props.size) > 0 ? Number(props.size) : 15
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 24 24',
					fill: 'none',
					'aria-hidden': 'true',
					style: { flex: 'none', display: 'block' },
				},
				h(
					'g',
					{ fill: 'currentColor' },
					[5, 12, 19].map((cy, index) => h('circle', { key: index, cx: 12, cy, r: 1.7 })),
				),
			)
		}

		/** A circular arrow: reload the article feed on the add page. */
		function RefreshGlyph(props) {
			const size = props && Number(props.size) > 0 ? Number(props.size) : 15
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 24 24',
					fill: 'none',
					'aria-hidden': 'true',
					style: { flex: 'none', display: 'block' },
				},
				h('g', { stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }, [
					h('path', { key: 'arc', d: 'M20.5 15a9 9 0 1 1-2.1-9.4' }),
					h('path', { key: 'head', d: 'M21 3.5V10h-6.5' }),
				]),
			)
		}

		/** The library's <check>: an article already in the exercise book. */
		function CheckGlyph(props) {
			const size = props && Number(props.size) > 0 ? Number(props.size) : 15
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', style: { flex: 'none', display: 'block' } },
				h(
					'g',
					{ fill: 'currentColor' },
					h(
						'g',
						null,
						h('path', {
							d: 'M8 15C4.13 15 1 11.87 1 8C1 4.13 4.13 1 8 1C11.87 1 15 4.13 15 8C15 11.87 11.87 15 8 15M8 16C12.42 16 16 12.42 16 8C16 3.58 12.42 0 8 0C3.58 0 0 3.58 0 8C0 12.42 3.58 16 8 16',
						}),
						h('path', {
							d: 'M10.97 4.97L10.95 4.99L7.48 9.42L5.38 7.32C5.09 7.05 4.63 7.06 4.34 7.34C4.06 7.63 4.05 8.09 4.32 8.38L6.97 11.03C7.11 11.17 7.31 11.25 7.51 11.25C7.72 11.25 7.91 11.16 8.05 11.01L12.04 6.02C12.32 5.72 12.32 5.25 12.02 4.97C11.73 4.68 11.26 4.68 10.97 4.97',
						}),
					),
				),
			)
		}

		/** The workspace's <ai-chat> icon, inline so currentColor reaches the strokes. */
		/**
		 * The workspace <checked> mark: a plain check tick, used for the selected
		 * level's checkbox (16×16 in the row).
		 * @param {object} props - optional size.
		 * @returns {object} element.
		 */
		function CheckedGlyph(props) {
			const size = props && Number(props.size) > 0 ? Number(props.size) : 16
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', style: { flex: 'none', display: 'block' } },
				h('path', { d: 'M3 8.5 6.5 12 13 4', stroke: 'currentColor', strokeWidth: 1.5 }),
			)
		}

		function AiChatGlyph() {
			return h(
				'svg',
				{ width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true', style: { flex: 'none', display: 'block' } },
				h('path', { d: 'M0 0h24v24H0z', fill: 'none' }),
				h(
					'g',
					{ fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 1.5 },
					h('path', { d: 'M12 3.25c5.1 0 9.25 3.6 9.25 8.25S17.1 19.75 12 19.75c-1.2 0-2.35-.2-3.4-.55l-4.25 1.6a.5.5 0 0 1-.65-.62l1.15-3.6c-1.25-1.38-2.1-3.13-2.1-5.08c0-4.65 4.15-8.25 9.25-8.25' }),
					h('path', { d: 'M12 7.25q.51 3.74 4.25 4.25q-3.74.51-4.25 4.25q-.51-3.74-4.25-4.25q3.74-.51 4.25-4.25' }),
				),
			)
		}

		/** The microphone from the DSH composer, inline for currentColor. */
		function MicGlyph() {
			return h(
				'svg',
				{ width: 17, height: 17, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, 'aria-hidden': 'true', style: { flex: 'none', display: 'block' } },
				h('rect', { x: '5.15', y: '1.65', width: '5.7', height: '8.7', rx: '2.85' }),
				h('path', { d: 'M2.35 8.675C3.075 11.3 5.2 13.125 8 13.125C10.8 13.125 12.925 11.3 13.65 8.675M8 13.125V15' }),
			)
		}

		function CoachButton({ t, open, disabled, onToggle }) {
			return h(
				'button',
				{
					type: 'button',
					className: 'dsh-de-icobtn dsh-de-icobtn-ghost',
					title: disabled ? t('coach.disabled') : t('coach.title'),
					'aria-label': t('coach.title'),
					'aria-pressed': open ? 'true' : 'false',
					disabled,
					onClick: onToggle,
				},
				h(AiChatGlyph),
			)
		}

		/** Decode a browser recording, resample to 16 kHz mono and encode PCM16 WAV. */
		async function audioBlobToWav(blob) {
			const AudioCtor = window.AudioContext || window.webkitAudioContext
			const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext
			const context = new AudioCtor()
			try {
				const decoded = await context.decodeAudioData(await blob.arrayBuffer())
				const rate = 16000
				const frames = Math.max(1, Math.ceil(decoded.duration * rate))
				const offline = new OfflineCtor(1, frames, rate)
				const source = offline.createBufferSource()
				source.buffer = decoded
				source.connect(offline.destination)
				source.start()
				const rendered = await offline.startRendering()
				const samples = rendered.getChannelData(0)
				const buffer = new ArrayBuffer(44 + samples.length * 2)
				const view = new DataView(buffer)
				const write = (offset, text) => {
					for (let at = 0; at < text.length; at += 1) view.setUint8(offset + at, text.charCodeAt(at))
				}
				write(0, 'RIFF')
				view.setUint32(4, 36 + samples.length * 2, true)
				write(8, 'WAVE')
				write(12, 'fmt ')
				view.setUint32(16, 16, true)
				view.setUint16(20, 1, true)
				view.setUint16(22, 1, true)
				view.setUint32(24, rate, true)
				view.setUint32(28, rate * 2, true)
				view.setUint16(32, 2, true)
				view.setUint16(34, 16, true)
				write(36, 'data')
				view.setUint32(40, samples.length * 2, true)
				for (let at = 0; at < samples.length; at += 1) {
					const sample = Math.max(-1, Math.min(1, samples[at]))
					view.setInt16(44 + at * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
				}
				return new Uint8Array(buffer)
			} finally {
				await context.close().catch(() => {})
			}
		}

		function bytesToBase64(bytes) {
			let binary = ''
			const chunk = 0x8000
			for (let at = 0; at < bytes.length; at += chunk) {
				binary += String.fromCharCode(...bytes.subarray(at, Math.min(bytes.length, at + chunk)))
			}
			return btoa(binary)
		}

		/**
		 * Article-scoped AI teacher. The thread lives outside the component so moving
		 * between result pages keeps it, while another article gets another thread.
		 * @param {object} props - props.
		 * @returns {object|null} panel.
		 */
		function CoachPanel({ t, unit, currentIndex, answer, open, onClose }) {
			const [messages, setMessages] = useState(() => coachThreads.get(unit.id) || [])
			const [input, setInput] = useState('')
			const [busy, setBusy] = useState(false)
			const [recording, setRecording] = useState(false)
			const [transcribing, setTranscribing] = useState(false)
			const [voiceError, setVoiceError] = useState('')
			const listRef = useRef(null)
			const textareaRef = useRef(null)
			const recorderRef = useRef(null)
			const streamRef = useRef(null)
			const chunksRef = useRef([])
			const stopTimerRef = useRef(null)
			const canRecord =
				typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && typeof MediaRecorder !== 'undefined'

			useEffect(() => {
				setMessages(coachThreads.get(unit.id) || [])
			}, [unit.id])

			useEffect(() => {
				if (!open) return
				if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
			}, [open, messages, busy])

			useEffect(() => {
				const element = textareaRef.current
				if (!element) return
				element.style.height = '0px'
				element.style.height = `${Math.min(140, Math.max(38, element.scrollHeight))}px`
			}, [input, open])

			useEffect(() => {
				if (open && textareaRef.current) textareaRef.current.focus()
			}, [open])

			const stopTracks = () => {
				if (streamRef.current) {
					for (const track of streamRef.current.getTracks()) track.stop()
					streamRef.current = null
				}
			}

			useEffect(() => () => {
				if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
				stopTracks()
				const recorder = recorderRef.current
				if (recorder && recorder.state !== 'inactive') {
					try {
						recorder.stop()
					} catch (error) {
						/* already stopped */
					}
				}
			}, [])

			const stopRecording = () => {
				if (stopTimerRef.current) {
					clearTimeout(stopTimerRef.current)
					stopTimerRef.current = null
				}
				const recorder = recorderRef.current
				if (!recorder || recorder.state === 'inactive') return
				try {
					recorder.stop()
				} catch (error) {
					/* noop */
				}
			}

			const startRecording = async () => {
				setVoiceError('')
				if (!canRecord) {
					setVoiceError(t('coach.voiceUnavailable'))
					return
				}
				try {
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
					streamRef.current = stream
					const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(
						(type) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type),
					)
					const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
					chunksRef.current = []
					recorder.ondataavailable = (event) => {
						if (event.data && event.data.size > 0) chunksRef.current.push(event.data)
					}
					recorder.onstop = async () => {
						const chunks = chunksRef.current
						const type = recorder.mimeType || 'audio/webm'
						recorderRef.current = null
						setRecording(false)
						stopTracks()
						if (chunks.length === 0) {
							setTranscribing(false)
							setVoiceError(t('coach.voiceFailed'))
							return
						}
						setTranscribing(true)
						try {
							const wav = await audioBlobToWav(new Blob(chunks, { type }))
							const reply = await api.voice({ audioBase64: bytesToBase64(wav), language: 'auto' })
							const text = String((reply && reply.text) || '').trim()
							if (text !== '') setInput((previous) => `${previous}${previous && text ? ' ' : ''}${text}`)
							else setVoiceError(t('coach.voiceEmpty'))
						} catch (error) {
							setVoiceError(
								error && error.code === 'voice-unavailable' ? t('coach.voiceUnavailable') : t('coach.voiceFailed'),
							)
						} finally {
							setTranscribing(false)
						}
					}
					recorderRef.current = recorder
					recorder.start()
					setRecording(true)
					stopTimerRef.current = setTimeout(() => stopRecording(), 60000)
				} catch (error) {
					setVoiceError(t('coach.voiceDenied'))
					stopTracks()
				}
			}

			const toggleVoice = () => {
				if (recording) stopRecording()
				else void startRecording()
			}


			if (!open) return null

			// The generator writes questions about the article it just wrote; older
			// units fall back to the sentence/article presets.
			const generatedQuestions = unit && Array.isArray(unit.questions) ? unit.questions.filter((line) => typeof line === 'string' && line !== '') : []
			const suggestions =
				generatedQuestions.length > 0
					? generatedQuestions.slice(0, 4)
					: currentIndex === null
						? [t('coach.suggestArticle1'), t('coach.suggestArticle2'), t('coach.suggestArticle3')]
						: [t('coach.suggestSentence1'), t('coach.suggestSentence2'), t('coach.suggestSentence3')]

			const send = async (text) => {
				const question = String(text || '').trim()
				if (question === '' || busy || recording || transcribing) return
				const history = messages.slice(-8).map((message) => ({ role: message.role, content: message.content }))
				const next = [...messages, { role: 'user', content: question }]
				setMessages(next)
				coachThreads.set(unit.id, next)
				setInput('')
				setBusy(true)
				try {
					const reply = await api.coach({
						id: unit.id,
						sentenceIndex: currentIndex,
						question,
						history,
						answer: answer || '',
					})
					const done = [...next, { role: 'assistant', content: String((reply && reply.answer) || '') || t('coach.failed') }]
					setMessages(done)
					coachThreads.set(unit.id, done)
				} catch (error) {
					const failed = [...next, { role: 'assistant', content: t('coach.failed') }]
					setMessages(failed)
					coachThreads.set(unit.id, failed)
				} finally {
					setBusy(false)
				}
			}

			return h(
				'aside',
				{ className: 'dsh-de-coach', 'aria-label': t('coach.title') },
				h(
					'div',
					{ className: 'dsh-de-coach-head' },
					h(
						'div',
						{ className: 'dsh-de-coach-heading' },
						h('div', { className: 'dsh-de-coach-title' }, t('coach.title')),
						h('div', { className: 'dsh-de-coach-sub' }, unit.title || ''),
					),
					h(
						'button',
						{ type: 'button', className: 'dsh-de-icobtn dsh-de-icobtn-ghost', title: t('coach.close'), 'aria-label': t('coach.close'), onClick: onClose },
						h(CloseGlyph),
					),
				),
				h(
					'div',
					{ className: 'dsh-de-coach-thread', ref: listRef },
					messages.length === 0
						? h(
								'div',
								{ className: 'dsh-de-coach-empty' },
								h('div', { className: 'dsh-de-coach-empty-title' }, t('coach.empty')),
								h(
									'div',
									{ className: 'dsh-de-coach-suggestions' },
									suggestions.map((suggestion) =>
										h(
											'button',
											{ type: 'button', className: 'dsh-de-coach-suggestion', key: suggestion, onClick: () => send(suggestion) },
											suggestion,
										),
									),
								),
							)
						: messages.map((message, index) =>
								h(
									'div',
									{ className: 'dsh-de-coach-message', 'data-role': message.role, key: `${index}-${message.role}` },
									message.content,
								),
							),
					busy ? h('div', { className: 'dsh-de-coach-message', 'data-role': 'assistant' }, t('coach.thinking')) : null,
				),
				h(
					'div',
					{ className: 'dsh-de-composer' },
					h('textarea', {
						ref: textareaRef,
						rows: 1,
						value: input,
						placeholder: t('coach.placeholder'),
						'aria-label': t('coach.placeholder'),
						onChange: (event) => setInput(event.target.value),
						onKeyDown: (event) => {
							if (event.key === 'Enter' && !event.shiftKey) {
								event.preventDefault()
								void send(input)
							}
						},
					}),
					voiceError ? h('div', { className: 'dsh-de-composer-error' }, voiceError) : null,
					h(
						'div',
						{ className: 'dsh-de-composer-bar' },
						canRecord
							? h(
									'button',
									{
										type: 'button',
										className: 'dsh-de-composer-voice',
										'data-listening': recording ? 'true' : 'false',
										'data-busy': transcribing ? 'true' : 'false',
										disabled: transcribing,
										title: recording ? t('coach.stopVoice') : transcribing ? t('coach.transcribing') : t('coach.voice'),
										'aria-label': recording ? t('coach.stopVoice') : t('coach.voice'),
										onClick: toggleVoice,
									},
									h(MicGlyph),
								)
							: null,
						h(
							'button',
							{
								type: 'button',
								className: 'dsh-de-composer-send',
								title: t('coach.send'),
								'aria-label': t('coach.send'),
								disabled: busy || recording || transcribing || input.trim() === '',
								onClick: () => void send(input),
							},
							'↑',
						),
					),
				),
			)
		}

		/* ───────────────────────────── Practice ───────────────────────────── */

		/**
		 * The dictation page for one sentence.
		 *
		 * A sentence is one unit with several questions: the first asks for one word,
		 * the next for a short phrase, and the last for the whole sentence. Every word
		 * of a question has its own input box, drawn as an underline as long as the
		 * word. `Space` moves to the next box, `Enter` checks the question: a wrong
		 * word gets a red underline and the first wrong box takes the focus again.
		 * @param {object} props - page props.
		 * @returns {object} element.
		 */
		/**
		 * The box a resumed question should focus: the first one still empty.
		 * @param {unknown} answers - the question's boxes.
		 * @returns {number} box index.
		 */
		function resumeFocusIndex(answers) {
			if (!Array.isArray(answers) || answers.length === 0) return 0
			const empty = answers.findIndex((value) => String(value ?? '') === '')
			return empty === -1 ? answers.length - 1 : empty
		}

		function Practice(props) {
			const { item, run, settings, t, tts, sound, onAnswer, onContinue, onSkip, onExit, onRetryReport } = props
			const ttsVersion = useSyncExternalStore(tts.subscribe, tts.getVersion, tts.getVersion)
			const speaking = (void ttsVersion, tts.isSpeaking())

			const words = useMemo(() => {
				const list = item && Array.isArray(item.words) ? item.words : []
				return list.map((word) => ({
					raw: word.text,
					plain: normalizeWord(word.text),
					pos: typeof word.pos === 'string' ? word.pos : 'other',
					ipa: typeof word.ipa === 'string' ? word.ipa : '',
					zh: typeof word.zh === 'string' ? word.zh : '',
					base: typeof word.base === 'string' ? word.base : '',
					form: typeof word.form === 'string' ? word.form : '',
					punct: punctuationOf(word.text),
				}))
			}, [item])

			// One question per phrase, then the whole sentence. The phrase questions are
			// scaffolding; only the last question is scored.
			const plan = useMemo(() => planOf(item, words), [item, words])
			const chunks = plan.chunks
			const roles = plan.roles
			const steps = useMemo(() => buildSteps(chunks, words.length), [chunks, words.length])
			const stepWordIndexes = useMemo(() => steps.map((step) => step.indexes), [steps])
			const stepTargetWords = useMemo(
				() => stepWordIndexes.map((indexes) => indexes.map((index) => (words[index] ? words[index].plain : ''))),
				[stepWordIndexes, words],
			)

			const sentenceNumber = useRef((run && run.index ? run.index : 0) + 1)
			// Coming back from another tab: the panel was unmounted, so the screen is
			// rebuilt from the draft instead of starting the same sentence over.
			const draft = useRef(practiceDraft && practiceDraft.itemId === item.id ? practiceDraft : null)
			const resume = draft.current
			const [stepIndex, setStepIndex] = useState(resume ? resume.stepIndex : 0)
			/** `listen` → `typing` → `reveal` (answer floating) / `card` (phrase accepted) → `done`. */
			const [phase, setPhase] = useState(resume && typeof resume.phase === 'string' ? resume.phase : 'typing')
			const [answers, setAnswers] = useState(resume && Array.isArray(resume.answers) ? resume.answers : [])
			const [focusIndex, setFocusIndex] = useState(resume ? resumeFocusIndex(resume.answers) : 0)
			const [wrongFlags, setWrongFlags] = useState([])
			const [card, setCard] = useState(resume && resume.card ? resume.card : null)
			const [feedback, setFeedback] = useState(resume && resume.feedback ? resume.feedback : null)
			const [answer, setAnswer] = useState(resume && resume.answer ? resume.answer : null)
			const [answerError, setAnswerError] = useState('')
			const [replays, setReplays] = useState(resume && Number.isFinite(resume.replays) ? resume.replays : 0)
			const [retrying, setRetrying] = useState(false)
			const [imeHint, setImeHint] = useState(false)
			const [focused, setFocused] = useState(true)
			const [listenDone, setListenDone] = useState(Boolean(resume && resume.listenDone))
			const [skipping, setSkipping] = useState(false)
			const [tick, setTick] = useState(0)
			const boxRefs = useRef([])
			const cardRef = useRef(null)
			const stepIndexRef = useRef(0)
			// A resumed sentence keeps the flags that decide its score: seeing the
			// answer or pressing a wrong key must not be forgotten by a tab switch.
			const screenRef = useRef(
				resume && resume.screen
					? { failed: resume.screen.failed === true, backspace: resume.screen.backspace === true, revealed: resume.screen.revealed === true }
					: { failed: false, backspace: false, revealed: false },
			)
			const submittingRef = useRef(false)
			const startedAt = useRef(Date.now() - (resume && Number.isFinite(resume.elapsedMs) ? resume.elapsedMs : 0))
			const lastInput = useRef(Date.now())
			const wordStats = useRef([])
			const rate = clamp(Number(settings && settings.rate) || RATE_NORMAL, 0.5, 2)
			const lastStep = steps.length - 1
			const step = steps[Math.min(stepIndex, lastStep)]
			const stepIndexes = stepWordIndexes[Math.min(stepIndex, lastStep)]
			const stepWords = stepIndexes.map((index) => words[index]).filter(Boolean)
			const stepRole = roles[Math.min(stepIndex, lastStep)] || 'predicate'
			const stepTargets = stepTargetWords[Math.min(stepIndex, lastStep)] || []
			const layout = underlineLayout(stepTargets)
			// Monospace glyphs are ~0.6em wide: shrink a long sentence enough to fit.
			const fieldFontPx = Math.min(28, Math.max(13, Math.floor(1150 / Math.max(1, layout.total))))
			const carriedMs = run && Number.isFinite(run.practiceMs) ? run.practiceMs : 0
			const elapsedNow = useCallback(() => Math.max(0, Date.now() - startedAt.current), [])

			useEffect(() => {
				const timer = setInterval(() => setTick((value) => value + 1), 500)
				return () => clearInterval(timer)
			}, [])

			// Entering the typing phase (from the preview or a card) locks the caret into
			// the current box once React has actually mounted it.
			useEffect(() => {
				if (phase !== 'typing') return undefined
				const timer = setTimeout(() => {
					const box = boxRefs.current[focusIndex]
					if (box && typeof box.focus === 'function' && document.activeElement !== box) box.focus({ preventScroll: true })
				}, 0)
				return () => clearTimeout(timer)
			}, [phase, focusIndex])

			// A fresh sentence gets a fresh per-question report; a resumed one keeps
			// the attempts that already happened in it.
			useEffect(() => {
				wordStats.current = resume && Array.isArray(resume.wordStats) ? resume.wordStats.map((entry) => ({ ...entry })) : []
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [item.id])

			// The card takes the focus so Enter advances without a button.
			useEffect(() => {
				if (phase !== 'card') return
				const element = cardRef.current
				if (element && typeof element.focus === 'function') element.focus({ preventScroll: true })
			}, [phase])

			// …and Enter/Tab advance even if the focus drifted somewhere else. This
			// listener exists only while a result is on screen, and only for those two
			// keys, so it cannot swallow typing.
			useEffect(() => {
				if (phase !== 'card') return undefined
				const onKeyDown = (event) => {
					if (cardKeyAction(event) !== 'next') return
					event.preventDefault()
					if (stepIndexRef.current < steps.length - 1) setStepIndex(stepIndexRef.current + 1)
				}
				document.addEventListener('keydown', onKeyDown, true)
				return () => document.removeEventListener('keydown', onKeyDown, true)
			}, [phase, steps.length])

			/** One question's words, as the card shows them. */
			const cardFor = useCallback(
				(index) => {
					const indexes = stepWordIndexes[Math.max(0, Math.min(index, lastStep))] || []
					const list = indexes.map((wordIndex) => words[wordIndex]).filter(Boolean)
					const posLabels = []
					for (const word of list) {
						const label = t(`pos.${word.pos}`)
						if (label && label !== `pos.${word.pos}` && !posLabels.includes(label)) posLabels.push(label)
					}
					const glosses = list.map((word) => word.zh).filter((gloss) => gloss !== '')
					return {
						text: list.map((word) => word.raw).join(' '),
						ipa: list.map((word) => word.ipa).filter((ipa) => ipa !== '').join(' '),
						pos: posLabels.join(' · '),
						zh: glosses.length > 0 ? glosses.join(' / ') : item.zh,
						role: roles[Math.max(0, Math.min(index, lastStep))] || 'predicate',
					}
				},
				[item.zh, lastStep, roles, stepWordIndexes, t, words],
			)

			/** Play one question's text: the phrase, or the whole sentence. */
			const playStep = useCallback(
				(index, slow) => {
					tts.cancel()
					const target = (stepTargetWords[Math.max(0, Math.min(index, stepTargetWords.length - 1))] || []).join(' ')
					tts.speak(target, { rate: slow ? RATE_SLOW : rate, voiceName: settings && settings.voiceName })
				},
				[rate, settings, stepTargetWords, tts],
			)

			const speakStep = useCallback(
				(slow) => {
					setReplays((count) => count + 1)
					playStep(stepIndex, slow)
					lastInput.current = Date.now()
									},
				[playStep, stepIndex],
			)

			const speakSentence = useCallback(() => {
				setReplays((count) => count + 1)
				tts.cancel()
				tts.speak(item.en, { rate, voiceName: settings && settings.voiceName })
			}, [item.en, rate, settings, tts])

			const speakWord = useCallback(
				(word, slow) => {
					if (!word) return
					setReplays((count) => count + 1)
					tts.cancel()
					tts.speak(word, { rate: slow ? RATE_SLOW : rate, voiceName: settings && settings.voiceName })
				},
				[rate, settings, tts],
			)

			// A new question starts empty, with the first box focused and its audio.
			// A resumed one is left exactly as it was: no reset, no second announcement.
			const resumedOnce = useRef(false)
			useEffect(() => {
				if (!resumedOnce.current && draft.current) {
					resumedOnce.current = true
					stepIndexRef.current = stepIndex
					screenRef.current = { failed: false, backspace: false, revealed: false }
					lastInput.current = Date.now()
					const index = resumeFocusIndex(answers)
					const refocus = setTimeout(() => {
						const box = boxRefs.current[index]
						if (box && typeof box.focus === 'function' && document.activeElement !== box) box.focus({ preventScroll: true })
					}, 0)
					// Back on the "listen first" screen with the audio already stopped by
					// the unmount: play it once, so Enter can be pressed with a reason.
					if (phase === 'listen' && !listenDone && tts.canSpeak()) {
						const replay = setTimeout(() => {
							tts.speak(item.en, { rate, voiceName: settings && settings.voiceName, onEnd: () => setListenDone(true) })
						}, 120)
						return () => {
							clearTimeout(replay)
							clearTimeout(refocus)
						}
					}
					return () => clearTimeout(refocus)
				}
				stepIndexRef.current = stepIndex
				screenRef.current = { failed: false, backspace: false, revealed: false }
				const announcing = stepIndex === 0 && tts.canSpeak()
				setPhase(announcing ? 'listen' : 'typing')
				setListenDone(false)
				setAnswers(new Array(stepIndexes.length).fill(''))
				setFocusIndex(0)
				setWrongFlags([])
				setCard(null)
								setImeHint(false)
				lastInput.current = Date.now()
				const first = announcing ? null : boxRefs.current[0]
				if (first && typeof first.focus === 'function') first.focus({ preventScroll: true })
				// Focus again on the next tick: a click or a late browser focus change
				// must not leave the new question without a caret.
				const refocus = setTimeout(() => {
					const box = boxRefs.current[0]
					if (box && typeof box.focus === 'function') box.focus({ preventScroll: true })
				}, 0)
				if (tts.canSpeak()) {
					const timer = setTimeout(() => {
						// Only a new sentence is announced (the teacher reads it once).
						// Question cues stay silent: the Chinese hint is the prompt, and
						// the pronunciation plays after a correct check.
						if (stepIndex === 0) {
							tts.speak(item.en, {
								rate,
								voiceName: settings && settings.voiceName,
								onEnd: () => setListenDone(true),
							})
						}
					}, 120)
					return () => {
						clearTimeout(timer)
						clearTimeout(refocus)
					}
				}
				return () => clearTimeout(refocus)
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, [stepIndex, item.id])

			const focusBox = useCallback((index) => {
				setFocusIndex(index)
				const box = boxRefs.current[index]
				if (box && typeof box.focus === 'function') {
					box.focus({ preventScroll: true })
					const end = String(box.value ?? '').length
					try {
						box.setSelectionRange(end, end)
					} catch (error) {
						/* some browsers refuse selection on a detached element */
					}
				}
			}, [])

			// While the sentence is announced, Enter / Space opens the first screen.
			useEffect(() => {
				if (phase !== 'listen') return undefined
				const onKeyDown = (event) => {
					const key = String(event.key ?? '')
					if (key === 'F11') {
						event.preventDefault()
						setListenDone(false)
						tts.speak(item.en, { rate, voiceName: settings && settings.voiceName, onEnd: () => setListenDone(true) })
						return
					}
					if (key !== 'Enter' && key !== ' ') return
					event.preventDefault()
					tts.cancel()
					setPhase('typing')
					focusBox(0)
				}
				document.addEventListener('keydown', onKeyDown, true)
				return () => document.removeEventListener('keydown', onKeyDown, true)
			}, [phase, focusBox, item.en, rate, settings, tts])

			const submit = useCallback(
				async (revealed) => {
					if (submittingRef.current) return
					submittingRef.current = true
					const state = screenRef.current
					const hadError = revealed === true ? false : state.failed
					const usedBackspace = revealed === true ? false : state.backspace
					const result = revealed === true ? 'reveal' : resultOf({ hadError, usedBackspace })
					const elapsedMs = elapsedNow()
					const comboBefore = run && Number.isFinite(run.combo) ? run.combo : 0
					const payload = {
						itemId: item.id,
						boxes: answers.slice(),
						typed: answers.map((entry) => String(entry ?? '')).join(' ').trim(),
						elapsedMs,
						replays,
						revealed: revealed === true,
						hadError,
						usedBackspace,
						skippedWords: [],
					}
					setPhase('done')
					setFeedback({
						result,
						points: sentenceScore(result, comboBefore),
						comboBefore,
						bonus: multiplier(comboBefore),
						elapsedMs,
						revealed: revealed === true,
					})
					tts.cancel()
					sound.play(result)
					try {
						const data = await onAnswer(payload)
						setAnswer(data)
						if (data && data.combo >= 3 && (result === 'perfect' || result === 'great')) sound.combo(data.combo)
					} catch (error) {
						setAnswerError(t('error.network'))
					} finally {
						submittingRef.current = false
					}
				},
				[answers, elapsedNow, item.id, onAnswer, replays, run, sound, t, tts],
			)

			/** Check the question: advance on a match, flag the wrong boxes on a miss. */
			const check = useCallback(() => {
				if (phase !== 'typing') return
				const wrong = wrongWordFlags(answers, stepTargets)
				const firstWrong = wrong.indexOf(true)
				const stats = wordStats.current
				if (!stats[stepIndex]) stats[stepIndex] = { attempts: 0, firstTry: true }
				stats[stepIndex].attempts += 1
				if (firstWrong !== -1) stats[stepIndex].firstTry = false
				lastInput.current = Date.now()
								if (firstWrong === -1) {
					setWrongFlags([])
					// Correct: now Say it out loud (the audio is the confirmation).
					playStep(stepIndex, false)
					if (stepIndex >= lastStep) {
						// The answer was shown: the sentence counts as revealed (0).
						submit(screenRef.current.revealed === true)
						return
					}
					setCard(cardFor(stepIndex))
					setPhase('card')
					sound.play('perfect')
					return
				}
				screenRef.current.failed = true
				setWrongFlags(wrong)
				sound.wrong()
				// Put the caret back on the first word that was wrong.
				focusBox(firstWrong)
			}, [answers, cardFor, focusBox, lastStep, phase, sound, stepIndex, stepTargets, submit])

			/** 看答案: float the answer over the page, then move on. */
			const [peek, setPeek] = useState(false)

			// Hold Option (macOS) / Alt (Windows) to look at the answer; release hides it
			// and returns the caret to the input. A peek, not the scored "show answer".
			useEffect(() => {
				if (phase !== 'typing') return undefined
				const down = (event) => {
					if (event.key === 'Alt' && !event.repeat) setPeek(true)
				}
				const up = (event) => {
					if (event.key !== 'Alt') return
					setPeek(false)
					const box = boxRefs.current[focusIndex]
					if (box && typeof box.focus === 'function') box.focus({ preventScroll: true })
				}
				document.addEventListener('keydown', down, true)
				document.addEventListener('keyup', up, true)
				return () => {
					document.removeEventListener('keydown', down, true)
					document.removeEventListener('keyup', up, true)
				}
			}, [phase, focusIndex])

			const openReveal = useCallback(() => {
				if (phase !== 'typing') return
				setPhase('reveal')
			}, [phase])

			/**
			 * Close the overlay and stay on the same question. Seeing the answer marks
			 * the question as revealed, so the sentence question will score 0; nothing
			 * advances until the user asks to.
			 */
			const closeReveal = useCallback(() => {
				if (phase !== 'reveal') return
				screenRef.current.revealed = true
				setPhase('typing')
				focusBox(focusIndex)
			}, [focusBox, focusIndex, phase])

			// While the answer floats over the page, Enter / Space / Escape close it.
			useEffect(() => {
				if (phase !== 'reveal') return undefined
				const onKeyDown = (event) => {
					const key = String(event.key ?? '')
					if (key !== 'Enter' && key !== ' ' && key !== 'Escape') return
					event.preventDefault()
					closeReveal()
				}
				document.addEventListener('keydown', onKeyDown, true)
				return () => document.removeEventListener('keydown', onKeyDown, true)
			}, [phase, closeReveal])

			const goNext = useCallback(() => {
				if (stepIndex >= lastStep) return
				setStepIndex(stepIndex + 1)
			}, [lastStep, stepIndex])

			const retryReport = useCallback(async () => {
				if (retrying) return
				setRetrying(true)
				try {
					const data = await onRetryReport(item.id)
					if (data && data.report) setAnswer((previous) => ({ ...(previous || {}), report: data.report }))
				} catch (error) {
					/* the card keeps its retry button */
				} finally {
					setRetrying(false)
				}
			}, [item.id, onRetryReport, retrying])

			const onBoxChange = useCallback(
				(index, event) => {
					const next = String(event.target.value ?? '')
					const previous = String(answers[index] ?? '')
					if (next.length < previous.length) screenRef.current.backspace = true
					setAnswers((current) => {
						const copy = current.slice()
						while (copy.length < stepIndexes.length) copy.push('')
						copy[index] = next
						return copy
					})
					if (wrongFlags[index]) {
						setWrongFlags((current) => {
							const copy = current.slice()
							copy[index] = false
							return copy
						})
					}
					lastInput.current = Date.now()
									},
				[answers, stepIndexes.length, wrongFlags],
			)

			const onBoxKeyDown = useCallback(
				(index, event) => {
					if (event.nativeEvent && event.nativeEvent.isComposing === true) return
					const action = shortcutOf(event)
					if (action !== null) {
						event.preventDefault()
						if (action === 'play') speakStep(false)
						else openReveal()
						return
					}
					if (event.key === ' ' || event.key === 'Spacebar') {
						// Space is the "next word" key: it never types a space. On the last
						// box it checks, exactly like Enter.
						event.preventDefault()
						if (index < stepWords.length - 1) focusBox(index + 1)
						else check()
						return
					}
					if (event.key === 'Backspace' && String(answers[index] ?? '') === '' && index > 0) {
						event.preventDefault()
						focusBox(index - 1)
						return
					}
					if (event.key === 'Enter') {
						event.preventDefault()
						check()
					}
				},
				[answers, check, focusBox, openReveal, speakStep, stepWords.length],
			)

			// Publish the screen for a remount: the sidebar tab may unmount this panel
			// at any moment. The tick keeps elapsed time fresh without extra state.
			useEffect(() => {
				practiceDraft = {
					itemId: item.id,
					stepIndex,
					answers,
					// The screen is restored exactly: the listen gate, an open answer
					// overlay, an accepted-question card, and the verdict card.
					phase,
					card,
					screen: { failed: screenRef.current.failed === true, backspace: screenRef.current.backspace === true, revealed: screenRef.current.revealed === true },
					feedback,
					answer,
					replays,
					listenDone,
					wordStats: (wordStats.current || []).map((entry) => ({ ...entry })),
					elapsedMs: Math.max(0, Date.now() - startedAt.current),
				}
			}, [item.id, stepIndex, answers, phase, card, feedback, answer, replays, listenDone, tick])

			const answerReady = answer !== null
			const canContinue = Boolean(answer)
			const nextItem = answer && answer.next ? answer.next : null
			const elapsed = phase === 'done' ? carriedMs + (feedback ? feedback.elapsedMs : 0) : carriedMs + elapsedNow()
			void tick

			const header = h(
				'div',
				{ className: 'dsh-de-topbar' },
				h(
					'button',
					{
						type: 'button',
						className: 'dsh-de-icobtn dsh-de-icobtn-ghost',
						title: t('practice.back'),
						'aria-label': t('practice.back'),
						onClick: () => {
							tts.cancel()
							onExit()
						},
					},
					h(BackGlyph),
				),
				h(
					'div',
					{ className: 'dsh-de-topbar-title' },
					h('b', null, 'English Dictation'),
					h(
						'span',
						null,
						t('practice.sentenceNo', { n: sentenceNumber.current }),
						h('span', { style: { opacity: 0.6 } }, ` · ${VERSION}`),
					),
				),
				h(
					'div',
					{ className: 'dsh-de-topbar-stats' },
					h('span', { className: 'dsh-de-chip' }, `${t('practice.score')} ${formatNumber(run ? run.score : 0)}`),
					h('span', { className: 'dsh-de-chip', 'data-tone': run && run.combo >= 3 ? 'brand' : 'plain' }, t('practice.combo', { n: run ? run.combo : 0 })),
					h('span', { className: 'dsh-de-chip' }, `${t('practice.grade')} ${(run && run.grade) || 'C'}`),
					h('span', { className: 'dsh-de-chip', title: t('practice.timeLabel') }, h(ClockGlyph, null), formatClock(elapsed)),
				),
			)

			const boxes = h(
				'div',
				{ className: 'dsh-de-group' },
				h(
					'div',
					{ className: 'dsh-de-boxes', style: { fontSize: `${fieldFontPx}px` } },
					stepWords.map((word, index) =>
						h(
							'div',
							{ className: 'dsh-de-wordcell', key: `${index}-${word.raw}` },
					step.kind !== 'sentence'
								? h(
										'div',
										{ className: 'dsh-de-annot' },
										h('div', { className: 'dsh-de-wordzh' }, String(word.zh || '').replace(/[A-Za-z]/g, '').split(/[；;、,，/]/)[0].trim()),
										word.pos && word.pos !== 'other'
											? h('div', { className: 'dsh-de-wordpos' }, t(`pos.${word.pos}`))
											: null,
									)
								: null,
					h('input', {
						ref: (element) => {
							boxRefs.current[index] = element
						},
						className: 'dsh-de-box',
						type: 'text',
						value: answers[index] ?? '',
						maxLength: Math.max(1, word.plain.length),
						autoComplete: 'off',
						autoCorrect: 'off',
						autoCapitalize: 'off',
						spellCheck: false,
						'aria-label': t('practice.typeHere'),
						'data-state': wrongFlags[index] ? 'wrong' : 'idle',
						style: {
							width: `${Math.max(1, word.plain.length)}ch`,
							border: 0,
							borderBottom: '2px solid',
							borderBottomColor: wrongFlags[index]
								? 'var(--dsw-alias-state-error-primary, #dc2626)'
								: focusIndex === index
									? 'var(--dsw-alias-brand-primary, #4f6bed)'
									: 'var(--dsw-alias-border-l2, rgba(0,0,0,.18))',
							borderRadius: 0,
							background: 'transparent',
							outline: 'none',
							textAlign: 'center',
							// Inline metrics beat any global input rule in the app shell.
							fontFamily: 'inherit',
							fontSize: 'inherit',
							lineHeight: '1.4',
							// auto (not a fixed height): the input sizes to its own line box,
							// so no global height rule can squeeze the glyphs
							height: 'auto',
							letterSpacing: '0',
						},
						onChange: (event) => onBoxChange(index, event),
						onKeyDown: (event) => onBoxKeyDown(index, event),
						onFocus: () => {
							setFocusIndex(index)
							setFocused(true)
							setImeHint(false)
						},
						onBlur: () => setFocused(false),
					}),
						word.punct
							? h('span', { className: 'dsh-de-punct', 'aria-hidden': 'true' }, word.punct)
							: null,
						),
					),
				),
			)

			// The Chinese prompt, always one line: each word contributes its gloss and
			// its form right after it ("我的" + "姐姐（单数）" → "我的姐姐（单数）").
			// Function words (to, for, the, and…) have no useful stand-alone meaning:
			// the model's gloss for them is noise ("并", "是"). Show their grammar role.
			const FUNCTION_WORDS = new Set([
				'to', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'about', 'into', 'over',
				'the', 'a', 'an', 'this', 'that', 'these', 'those', 'and', 'or', 'but', 'so',
				'if', 'when', 'while', 'because', 'as', 'than', 'that', 'my', 'your', 'his', 'her',
				'its', 'our', 'their', 'some', 'any', 'no', 'not', 'do', 'does', 'did', 'is', 'are',
				'was', 'were', 'be', 'been', 'have', 'has', 'had', 'will', 'would', 'can', 'could',
				'should', 'may', 'might', 'must',
			])
			const glossOf = (word) => {
				if (FUNCTION_WORDS.has(word.plain) && (word.pos === 'det' || word.pos === 'prep' || word.pos === 'conj' || word.pos === 'pron' || word.pos === 'aux')) {
					return t(`pos.${word.pos}`)
				}
				return String(word.zh || '')
					.replace(/[A-Za-z]/g, '')
					.split(/[；;、,，/]/)[0]
					.trim()
			}
			const hintText =
				step.kind === 'sentence'
					? item.zh || ''
					: stepWords.map((word) => glossOf(word)).filter((line) => line !== '').join('')
			const inputForm = h(
				'form',
				{
					className: 'dsh-de-answer-form',
					onSubmit: (event) => {
						event.preventDefault()
						check()
					},
				},
				step.kind === 'sentence' && item.zh
					? h('div', { className: 'dsh-de-cn-hint', style: { fontSize: '16px', textAlign: 'center' } }, item.zh)
					: null,
				boxes,
				h(
					'div',
					{ className: 'dsh-de-shortcuts' },
					h('kbd', null, 'Space'),
					' ',
					t('practice.nextWord'),
					' · ',
					h('kbd', null, 'Enter'),
					' ',
					t('practice.shortcutSubmit'),
					' · ',
					h('kbd', null, 'Ctrl+I'),
					' ',
					t('practice.shortcutPlay'),
					' · ',
					h('kbd', null, 'Ctrl+;'),
					' ',
					t('practice.shortcutReveal'),
				),
				imeHint ? h('div', { className: 'dsh-de-form-hint' }, t('practice.imeHint')) : null,
				!focused ? h('div', { className: 'dsh-de-form-hint' }, t('practice.focusHint')) : null,
			)
			// The answer floats over the page: one block per word with IPA, the word,
			// an accent line, the grammar/meaning line and the part of speech.
			const revealOverlay =
				phase === 'reveal' || peek
					? h(
							'div',
							{ className: 'dsh-de-reveal-overlay', onClick: closeReveal, role: 'dialog', 'aria-modal': 'true' },
							h(
								'div',
								{
									className: 'dsh-de-reveal-card',
									onClick: (event) => event.stopPropagation(),
								},
								h('div', { className: 'dsh-de-reveal-tag' }, t(`role.${stepRole}`)),
								h(
									'div',
									{ className: 'dsh-de-reveal-words' },
									stepWords.map((word, index) => {
										const base = word.base ? `${word.base}${word.form ? `（${word.form}）` : ''}` : ''
										const gloss = base !== '' && word.zh !== '' ? `${base}：${word.zh}` : base !== '' ? base : word.zh
										return h(
											'div',
											{ className: 'dsh-de-rw', key: `${index}-${word.raw}` },
											h('div', { className: 'dsh-de-rw-word' }, word.raw.replace(/[^A-Za-z'’-]/g, '')),
											h('div', { className: 'dsh-de-rw-accent', style: { background: REVEAL_ACCENTS[index % REVEAL_ACCENTS.length] } }),
											gloss ? h('div', { className: 'dsh-de-rw-gloss' }, gloss) : null,
											h('div', { className: 'dsh-de-rw-pos' }, t(`pos.${word.pos}`)),
										)
									}),
								),
								stepWords.some((word) => word.zh !== '' || word.base !== '')
									? null
									: item.zh
										? h('div', { className: 'dsh-de-reveal-gloss' }, item.zh)
										: null,
								h('div', { className: 'dsh-de-reveal-hint' }, t('practice.revealCloseHint')),
							),
						)
					: null

			// The card a phrase gets when it is accepted.
			const wordCard =
				phase === 'card' && card
					? h(
							'div',
							{
								className: 'dsh-de-wordcard',
								ref: cardRef,
								tabIndex: -1,
							},
							h('div', { className: 'dsh-de-wc-role' }, t(`role.${card.role || 'predicate'}`)),
							h('div', { className: 'dsh-de-wc-status' }, '✓ ', t('practice.correct')),
							h('div', { className: 'dsh-de-wc-word' }, card.text),
							h('div', { className: 'dsh-de-wc-accent', 'aria-hidden': 'true' }),
							card.pos ? h('div', { className: 'dsh-de-wc-pos' }, card.pos) : null,
							card.zh ? h('div', { className: 'dsh-de-wc-zh' }, card.zh) : null,
							h('div', { className: 'dsh-de-wc-hint' }, h('kbd', null, 'Enter'), ' ', t('practice.pressEnter')),
						)
					: null

			/* ---- verdict card for the sentence screen ---- */
			let feedbackCard = null
			if (phase === 'done' && feedback) {
				const resultKind = feedback.result
				const resultText =
					resultKind === 'perfect'
						? t('feedback.perfectCombo', { n: answer ? answer.combo : feedback.comboBefore + 1 })
						: resultKind === 'great'
							? t('feedback.great')
							: resultKind === 'pass'
								? t('feedback.pass')
								: t('feedback.reveal')
				const reportRows = steps.map((reportStep, index) => {
					const entry = wordStats.current[index] || null
					return {
						text: reportStep.indexes.map((wordIndex) => (words[wordIndex] ? words[wordIndex].raw : '')).join(' '),
						attempts: entry ? entry.attempts : 0,
						firstTry: entry ? entry.firstTry !== false : true,
					}
				})
				const reviewBlock = h(
					'div',
					{ className: 'dsh-de-fb-review' },
					h('div', { className: 'dsh-de-review-label' }, t('feedback.wordReport')),
					h(
						'div',
						{ className: 'dsh-de-report' },
						reportRows.map((row, index) =>
							h(
								'div',
								{ className: 'dsh-de-report-row', key: index },
								h('span', { className: 'dsh-de-report-word' }, row.text),
								h(
									'span',
									{ className: 'dsh-de-report-mark', 'data-tone': row.firstTry ? 'good' : 'warn' },
									row.firstTry ? '✓' : `${row.attempts}×`,
								),
							),
						),
					),
				)
				feedbackCard = h(
					'section',
					{ className: 'dsh-de-feedback' },
					h(
						'div',
						{ className: 'dsh-de-fb-head' },
						h('div', { className: 'dsh-de-fb-result', 'data-kind': resultKind }, resultText),
						h(
							'div',
							{ className: 'dsh-de-fb-meta' },
							feedback.revealed
								? h('span', null, t('feedback.unscored'))
								: h('span', null, t('feedback.seconds', { seconds: (feedback.elapsedMs / 1000).toFixed(1) })),
							!feedback.revealed && feedback.bonus > 1 ? h('span', { className: 'dsh-de-chip', 'data-tone': 'brand' }, t('feedback.bonus', { value: feedback.bonus })) : null,
						),
					),
					h(
						'div',
						{ className: 'dsh-de-sentence' },
						words.map((word, index) =>
							h(
								'span',
								{ className: 'dsh-de-word', key: `${index}-${word.raw}`, onClick: () => speakWord(word.plain) },
								h('span', { className: 'dsh-de-wordtext', 'data-pos': word.pos }, word.raw),
								word.ipa ? h('span', { className: 'dsh-de-ipa' }, word.ipa) : null,
							),
						),
					),
					reviewBlock,
					h(
						'div',
						{ className: 'dsh-de-fb-actions' },
						h(
							'button',
							{
								type: 'button',
								className: 'dsh-de-continue',
								disabled: !canContinue,
								onClick: () => {
									if (canContinue) void onContinue(null)
								},
							},
							t('feedback.continue'),
							h('span', { className: 'dsh-de-continue-hint' }, '⏎'),
						),
						h(
							'button',
							{ type: 'button', className: 'dsh-de-secondary', onClick: () => onExit() },
							t('practice.back'),
						),
						h('span', { className: 'dsh-de-hint' }, answerError ? '' : canContinue ? t('feedback.continueHint') : t('practice.generating')),
					),
				)
			}

			return h(
				'div',
				{ className: 'dsh-de-practice' },
				header,
				h(
					'div',
					// Any click in the stage puts the caret back in the field.
					{
						className: 'dsh-de-stage',
						onClick: (event) => {
							// A click on one of the audio buttons does its own thing; only a
							// click on empty space advances the card or restores the caret.
							const target = event && event.target
							const fromButton = target && typeof target.closest === 'function' && target.closest('button') !== null
							if (phase === 'card') {
								if (!fromButton) goNext()
								return
							}
							if (phase === 'listen') {
								setPhase('typing')
								focusBox(0)
								return
							}
							const box = boxRefs.current[focusIndex]
							if (box && typeof box.focus === 'function') box.focus({ preventScroll: true })
						},
					},
					h(
						'div',
						{ className: 'dsh-de-center' },
						phase === 'listen'
							? h(
									'div',
									{ className: 'dsh-de-listen' },
									h(
										'div',
										{ className: 'dsh-de-listen-text' },
										listenDone ? t('practice.pressStart') : t('practice.listenFirst'),
									),
									listenDone
										? h(
												'button',
												{
													type: 'button',
													className: 'dsh-de-ghost',
													disabled: skipping,
													onClick: () => {
														setSkipping(true)
														// A failed skip keeps this sentence: release the button
														// instead of leaving it stuck on "AI is writing…".
														if (!onSkip) {
															setSkipping(false)
															return
														}
														void Promise.resolve(onSkip()).then(
															(moved) => {
																if (moved === false) setSkipping(false)
															},
															() => setSkipping(false),
														)
													},
												},
												skipping ? t('practice.generatingShort') : t('practice.skip'),
											)
										: null,
								)
							: null,
						phase === 'typing'
							? h(
									'div',
									{ className: 'dsh-de-stage-label' },
									step.kind === 'chunk'
										? t('practice.phraseStage', { n: stepIndex + 1, total: chunks.length })
										: `${t('practice.sentenceStage')} · ${t('role.whole')}`,
									step.kind === 'sentence' ? h('span', { className: 'dsh-de-enter-now' }, ` · ${t('practice.scoredScreen')}`) : null,
								)
							: null,
						phase === 'typing'
							? h(
									'div',
									{ className: 'dsh-de-answer-wrap' },
									inputForm,
									h(
										'div',
										{ className: 'dsh-de-ghosts' },
										h('button', { type: 'button', className: 'dsh-de-ghost', onClick: openReveal, title: t('practice.revealHint') }, t('practice.reveal')),
									),
								)
							: null,
						wordCard,
						feedbackCard,
					),
				),
				revealOverlay,
			)
		}

		/* ───────────────────────────── Home ───────────────────────────── */

		/**
		 * One stat card from the home header: a quiet label over a number and
		 * its unit. The unit is secondary and smaller so the number leads.
		 * @param {string} label - card caption.
		 * @param {string} value - the number.
		 * @param {string} [unit] - unit after the number.
		 * @returns {object} element.
		 */
		function statCard(label, value, unit) {
			return h(
				'div',
				{ className: 'dsh-de-statcard' },
				h('div', { className: 'dsh-de-statcard-label' }, label),
				h(
					'div',
					{ className: 'dsh-de-statcard-value' },
					h('span', { className: 'dsh-de-statcard-number' }, value),
					unit ? h('span', { className: 'dsh-de-statcard-unit' }, unit) : null,
				),
			)
		}

		/**
		 * The home screen: the counters, then every exercise in the book.
		 *
		 * This is the design's whole first screen — no feed, no level selector.
		 * Adding an exercise is the one action, and it lives in the top right;
		 * everything else (voice, archive, sound) hides behind the header menu so
		 * the list stays the only thing competing for attention.
		 * @param {object} props - page props.
		 * @returns {object} element.
		 */
		function Home(props) {
			const { t, data, savedArticles, summary, generatingArticle, notice, settings, updateSettings, voicePanel } = props
			const exercises = Array.isArray(savedArticles) ? savedArticles : []
			const stats = homeStats(data, exercises, summary)
			const time = timeStatOf(stats.elapsedMs)
			// A menu item must also close its dropdown; `<details>` keeps the state
			// in the DOM, so no component state is needed here.
			const closeMenu = (event) => {
				const current = event && event.currentTarget ? event.currentTarget : null
				const details = current && typeof current.closest === 'function' ? current.closest('details') : null
				if (details) details.open = false
			}
			const open = (entry) => {
				if (!entry || generatingArticle === true) return
				if (typeof props.onOpenSaved === 'function') props.onOpenSaved(entry.id)
			}
			const remove = (event, entry) => {
				closeMenu(event)
				if (!entry || typeof props.onRemoveSaved !== 'function') return
				props.onRemoveSaved(entry.id)
			}

			const header = h(
				'header',
				{ className: 'dsh-de-homehead' },
				h(
					'div',
					{ className: 'dsh-de-homeheading' },
					h('h1', { className: 'dsh-de-hometitle' }, 'English Dictation'),
					h('p', { className: 'dsh-de-homesub' }, t('home.subtitle')),
				),
				h(
					'div',
					{ className: 'dsh-de-homeactions' },
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-de-addbtn',
							onClick: () => {
								if (typeof props.onAddExercise === 'function') props.onAddExercise()
							},
						},
						h(PlusGlyph, { size: 13 }),
						h('span', null, t('home.addExercise')),
					),
					h(
						'details',
						{ className: 'dsh-de-menu' },
						h(
							'summary',
							{ className: 'dsh-de-morebtn', title: t('home.more'), 'aria-label': t('home.more') },
							h(MoreGlyph, null),
						),
						h(
							'div',
							{ className: 'dsh-de-menu-panel' },
							typeof props.onVoice === 'function'
								? h(
										'button',
										{
											type: 'button',
											className: 'dsh-de-menu-item',
											onClick: (event) => {
												closeMenu(event)
												props.onVoice()
											},
										},
										t('voice.title'),
									)
								: null,
							typeof props.onArchive === 'function'
								? h(
										'button',
										{
											type: 'button',
											className: 'dsh-de-menu-item',
											onClick: (event) => {
												closeMenu(event)
												props.onArchive()
											},
										},
										t('archive.title'),
									)
								: null,
						),
					),
				),
			)

			const counters = h(
				'div',
				{ className: 'dsh-de-counters' },
				statCard(t('home.statTime'), time.value, t(time.unitKey)),
				statCard(t('home.statArticles'), String(stats.articles), t('home.unitArticle')),
				statCard(t('home.statDictation'), String(stats.dictation), t('home.unitScore')),
				statCard(t('home.statVocabulary'), String(stats.vocabulary), t('home.unitWord')),
				statCard(t('home.statStreak'), String(stats.streak), t('home.unitDay')),
			)

			const rows = exercises.map((entry) => {
				const level = exerciseCefr(entry)
				const total = Math.max(0, Number(entry.sentences) || 0)
				const current = Math.max(0, Math.min(total, Number(entry.current) || 0))
				const phase = typeof entry.phase === 'string' ? entry.phase : entry.started === true ? 'typing' : 'none'
				const hasScore = phase === 'done' && entry.score && Number.isFinite(Number(entry.score.value))
				const stateLabel = hasScore ? '' : phase === 'done' ? t('home.completed') : phase === 'none' ? t('home.notStarted') : t('home.inProgress')
				return h(
					'div',
					{ className: 'dsh-de-exrow', key: entry.id },
					h('span', { className: 'dsh-de-level', 'data-band': cefrBand(level) }, level),
					h('span', { className: 'dsh-de-extitle', title: displayTitle(entry.title) }, displayTitle(entry.title)),
					h(
						'span',
						{ className: 'dsh-de-exstatus' },
						hasScore
							? h('b', { className: 'dsh-de-exscore-text', title: t('score.composite') }, String(Math.round(Number(entry.score.value))))
							: h('span', { className: 'dsh-de-exstate', 'data-state': phase }, stateLabel),
						h('span', { className: 'dsh-de-exsep' }, '·'),
						h('span', { className: 'dsh-de-exprogress' }, `${current}/${total}`),
					),
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-de-rowgo',
							title: t('home.open'),
							'aria-label': t('home.open'),
							disabled: generatingArticle === true,
							onClick: () => open(entry),
						},
						h(ArrowRightGlyph, { size: 12 }),
					),
					h(
						'details',
						{ className: 'dsh-de-menu dsh-de-menu-row' },
						h(
							'summary',
							{ className: 'dsh-de-rowmore', title: t('home.more'), 'aria-label': t('home.more') },
							h(MoreGlyph, { size: 14 }),
						),
						h(
							'div',
							{ className: 'dsh-de-menu-panel dsh-de-menu-panel-right' },
							typeof props.onRemoveSaved === 'function'
								? h(
										'button',
										{ type: 'button', className: 'dsh-de-menu-item dsh-de-menu-item-danger', onClick: (event) => remove(event, entry) },
										t('home.remove'),
									)
								: null,
						),
					),
				)
			})

			const list = h(
				'section',
				{ className: 'dsh-de-exercises' },
				h('div', { className: 'dsh-de-exhead' }, t('home.exercises', { n: exercises.length })),
				exercises.length === 0
					? h('div', { className: 'dsh-de-exempty' }, t('home.empty'))
					: h(
							'div',
							{ className: 'dsh-de-exlist' },
							rows,
						),
			)

			return h(
				'div',
				{ className: 'dsh-de-page' },
				h(
					'div',
					{ className: 'dsh-de-homewrap' },
					header,
					counters,
					list,
					notice ? h('div', { className: 'dsh-de-hint dsh-de-homenotice' }, notice) : null,
				),
				voicePanel,
			)
		}

		/* ───────────────────────────── Add exercises ───────────────────────────── */

		/** How many source rows the add page reveals per "loading more". */
		// The first screen shows the whole usual timeline (about 40 rows), with
		// the same step behind 「加载更多」 for a longer history.
		const ADD_PAGE_SIZE = 50
		// The topic bar is stable: every category is offered even before a feed
		// row for it has arrived.
		const ADD_TOPICS = ['science', 'environment', 'technology', 'health', 'society', 'psychology']
		const ADD_SKELETON_ROWS = 8
		/** The CEFR levels the add page offers; the Host enforces the target. */
		const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

		/**
		 * One article's source mark.
		 *
		 * The favicon comes from our own Host route (see `lib/favicon.js`), so the
		 * page never talks to a provider site and the CSP stays untouched. When it
		 * cannot be resolved — unknown provider, offline, 404 — the square falls
		 * back to the source's initial, which still names the source at a glance.
		 * @param {object} props - provider id and the human label.
		 * @returns {object} element.
		 */
		function SourceIcon(props) {
			const { provider, label } = props
			const [broken, setBroken] = useState(false)
			const src = typeof provider === 'string' && provider !== '' ? api.favicon(provider) : ''
			const initial = typeof label === 'string' && label !== '' ? label.trim().slice(0, 1).toUpperCase() : '?'
			if (broken === true || src === '') {
				return h('span', { className: 'dsh-de-addico dsh-de-addico-fallback', title: label || '', 'aria-hidden': 'true' }, initial)
			}
			return h('img', {
				className: 'dsh-de-addico',
				src,
				alt: '',
				loading: 'lazy',
				decoding: 'async',
				'aria-hidden': 'true',
				onError: () => setBroken(true),
			})
		}

		/**
		 * The original article's URL, as a small external-link icon beside the
		 * exercise title. It opens in a new tab; an exercise without a source URL
		 * renders nothing. (The workspace icon library has no external-link glyph,
		 * so this reuses the right arrow rotated to point out.)
		 * @param {object} props - url and translator.
		 * @returns {object|null} element.
		 */
		function SourceLink(props) {
			const { url, t } = props
			if (typeof url !== 'string' || url === '') return null
			return h(
				'a',
				{
					className: 'dsh-de-srclink',
					href: url,
					target: '_blank',
					rel: 'noopener noreferrer',
					title: t('practice.viewSource'),
					'aria-label': t('practice.viewSource'),
				},
				h(ArrowRightGlyph, { size: 12 }),
			)
		}

		/**
		 * The level dialog: the one decision the add page defers to a click.
		 *
		 * It is a separate component so it can be rendered (and tested) on its
		 * own: the page owns which row was clicked, this owns nothing but the
		 * presentation of the choice. Esc and the backdrop both cancel.
		 * @param {object} props - dialog props.
		 * @returns {object} element.
		 */
		function LevelDialog(props) {
			const { t, item, value, myLevel, busy, modelName, settings, tts, onSettings, onChange, onConfirm, onCancel } = props
			const defaultLevel = CEFR_LEVELS.includes(myLevel) ? myLevel : 'B1'
			const active = CEFR_LEVELS.includes(value) ? value : defaultLevel
			const cancel = () => {
				if (typeof onCancel === 'function') onCancel()
			}
			const ref = useRef(null)
			// The dialog owns its keyboard: Esc cancels from anywhere, and focus
			// moves into the card so Tab starts there.
			useEffect(() => {
				if (ref.current && typeof ref.current.focus === 'function') ref.current.focus({ preventScroll: true })
				if (typeof document === 'undefined') return undefined
				const onKey = (event) => {
					if (event.key === 'Escape') {
						event.preventDefault()
						cancel()
					}
				}
				document.addEventListener('keydown', onKey, true)
				return () => document.removeEventListener('keydown', onKey, true)
			}, [])
			const title = item && typeof item.title === 'string' ? displayTitle(item.title) : ''
			const summary = item && typeof item.summary === 'string' ? item.summary : ''
			const url = item && typeof item.url === 'string' ? item.url : ''
			const domain = domainOf(url)
			const model = typeof modelName === 'string' ? modelName.trim() : ''
			const modelLine = model !== '' ? t('add.hostModel', { model }) : t('add.hostModelFallback')
			const currentSettings = settings && typeof settings === 'object' ? settings : {}
			const voiceEngine = currentSettings.engine || (tts && typeof tts.engine === 'function' ? tts.engine() : 'cloud')
			const voices = tts && typeof tts.englishVoices === 'function' ? tts.englishVoices() : []
			const cloudReady = tts && typeof tts.cloudReady === 'function' ? tts.cloudReady() : false
			const cloudVoice = currentSettings.cloudVoice || (tts && typeof tts.cloudVoice === 'function' ? tts.cloudVoice() : CLOUD_VOICES[0])
			const systemVoice = currentSettings.voiceName || (tts && typeof tts.voiceName === 'function' ? tts.voiceName() : '') || (voices[0] ? voices[0].name : '')
			const hasAnyVoice = cloudReady || voices.length > 0
			const selectedVoice = cloudReady && (voiceEngine === 'cloud' || voices.length === 0) ? `cloud:${cloudVoice}` : voices.length > 0 ? `system:${systemVoice}` : ''
			const optionRate = clamp(Number(currentSettings.rate) || RATE_NORMAL, 0.5, 2)
			const setOption = (patch) => {
				if (typeof onSettings === 'function') onSettings(patch)
			}
			const chooseVoice = (event) => {
				const value = event && event.target ? String(event.target.value) : ''
				if (value.startsWith('cloud:')) setOption({ engine: 'cloud', cloudVoice: value.slice('cloud:'.length) })
				else if (value.startsWith('system:')) setOption({ engine: 'system', voiceName: value.slice('system:'.length) })
			}
			const optionVoiceSelect = h(
				'select',
				{ className: 'dsh-de-opts-select', value: selectedVoice, disabled: hasAnyVoice !== true, onChange: chooseVoice },
				h(
					'optgroup',
					{ label: t('voice.engineCloud'), disabled: cloudReady !== true },
					CLOUD_VOICES.map((voice) => h('option', { value: `cloud:${voice}`, key: `cloud:${voice}` }, voice === 'stella' ? t('voice.cloudStella') : t('voice.cloudTide'))),
				),
				h(
					'optgroup',
					{ label: t('voice.engineSystem'), disabled: voices.length === 0 },
					voices.map((voice) => h('option', { value: `system:${voice.name}`, key: `system:${voice.name}` }, `${voice.name} (${voice.lang})`)),
				),
				hasAnyVoice ? null : h('option', { value: '', disabled: true }, t('voice.unavailable')),
			)
			return h(
				'div',
				{
					className: 'dsh-de-modal',
					role: 'presentation',
					onClick: (event) => {
						if (event && event.target === event.currentTarget) cancel()
					},
				},
				h(
					'div',
					{
						className: 'dsh-de-dialog',
						role: 'dialog',
						'aria-modal': 'true',
						'aria-label': t('add.dialogTitle'),
						tabIndex: -1,
						ref,
						onClick: (event) => {
							if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
						},
					},
					h(
						'div',
						{ className: 'dsh-de-dialog-head' },
						h('h2', { className: 'dsh-de-dialog-title' }, t('add.dialogTitle')),
						h(
							'button',
							{
								type: 'button',
								className: 'dsh-de-dialog-close',
								title: t('add.cancel'),
								'aria-label': t('add.cancel'),
								onClick: cancel,
							},
							h(CloseGlyph),
						),
					),
					h(
						'div',
						{ className: 'dsh-de-article' },
						h('h3', { className: 'dsh-de-article-title' }, title),
						summary !== '' ? h('p', { className: 'dsh-de-article-summary' }, summary) : null,
						h(
							'div',
							{ className: 'dsh-de-article-meta' },
							h(SourceIcon, { provider: item && item.provider, label: item && item.source }),
							domain !== '' ? h('span', { className: 'dsh-de-article-domain' }, domain) : null,
							h(SourceLink, { url, t }),
						),
					),
					h('h3', { className: 'dsh-de-level-heading' }, t('add.levelSection')),
					h('p', { className: 'dsh-de-dialog-hint' }, t('add.dialogHint')),
					h(
						'div',
						{ className: 'dsh-de-levelselectwrap' },
						h(
							'select',
							{
								className: 'dsh-de-levelselect',
								value: active,
								disabled: busy === true,
								'aria-label': t('add.levelSection'),
								onChange: (event) => {
									if (typeof onChange === 'function') onChange(event.target.value)
								},
							},
							CEFR_LEVELS.map((id) => h('option', { value: id, key: id }, `${id} · ${t(`cefr.${id}.name`)}`)),
						),
						h('span', { className: 'dsh-de-levelchevron', 'aria-hidden': 'true' }),
					),
					h(
						'p',
						{ className: 'dsh-de-leveldef', 'data-level': active },
						h('b', { className: 'dsh-de-leveldef-id' }, active),
						t(`cefr.${active}.def`),
					),
					h(
						'details',
						{ className: 'dsh-de-addopts' },
						h(
							'summary',
							{ className: 'dsh-de-addopts-summary' },
							h('span', { className: 'dsh-de-addopts-chev', 'aria-hidden': 'true' }),
							t('add.options'),
						),
						h(
							'div',
							{ className: 'dsh-de-addopts-body' },
							h(
								'div',
								{ className: 'dsh-de-tag-row' },
								h('span', { className: 'dsh-de-tag-name' }, t('add.optionsVoice')),
								optionVoiceSelect,
							),
							h(
								'div',
								{ className: 'dsh-de-tag-row' },
								h('span', { className: 'dsh-de-tag-name' }, t('add.optionsRate')),
								h('input', {
									type: 'range',
									min: 0.5,
									max: 2,
									step: 0.05,
									value: optionRate,
									onChange: (event) => setOption({ rate: Number(event.target.value) }),
									style: { flex: '1 1 auto' },
								}),
								h('span', { className: 'dsh-de-tag-value' }, optionRate.toFixed(2)),
							),
						),
					),
					h(
						'div',
						{ className: 'dsh-de-dialog-foot' },
						h(
							'p',
							{ className: 'dsh-de-dialog-note', title: t('add.hostModelHint') },
							h('span', { className: 'dsh-de-checkbox', 'aria-hidden': 'true' }, h(CheckedGlyph, { size: 16 })),
							modelLine,
						),
						h(
							'button',
							{
								type: 'button',
								className: 'dsh-de-dialog-go',
								disabled: busy === true,
								onClick: () => {
									if (busy === true || typeof onConfirm !== 'function') return
									onConfirm(active)
								},
							},
							t('add.generate', { level: active }),
						),
					),
				),
			)
		}

		/**
		 * The add page: one time-ordered stream from every source, a topic
		 * filter, and a plus that opens a level dialog.
		 *
		 * The level is *not* a page-wide filter. It is the learner's own level,
		 * chosen when they add an article: the plus opens a small dialog, the
		 * dialog preselects the level saved in the profile, and confirming
		 * rewrites the source at that level and puts it in the book. One article
		 * is therefore one exercise at one level — never three near-duplicates.
		 * @param {object} props - page props.
		 * @returns {object} element.
		 */
		function AddExercise(props) {
			const { t, items, status, savedArticles, myLevel, busyId, refreshing, modelName, settings, tts, ttsVersion, onSettings } = props
			void ttsVersion
			const feed = Array.isArray(items) ? items : []
			const saved = Array.isArray(savedArticles) ? savedArticles : []
			const [limit, setLimit] = useState(ADD_PAGE_SIZE)
			const [picking, setPicking] = useState(null)
			const [choice, setChoice] = useState(() => (CEFR_LEVELS.includes(myLevel) ? myLevel : 'B1'))
			const [query, setQuery] = useState('')
			const [applied, setApplied] = useState('')
			const [ingesting, setIngesting] = useState(false)
			const activeTopic = typeof props.topic === 'string' && props.topic !== '' ? props.topic : 'all'
			const defaultLevel = CEFR_LEVELS.includes(myLevel) ? myLevel : 'B1'
			const topicCounts = useMemo(() => {
				const counts = new Map()
				for (const item of feed) {
					const id = item && typeof item.topic === 'string' && item.topic !== '' ? item.topic : 'other'
					counts.set(id, (counts.get(id) || 0) + 1)
				}
				return counts
			}, [feed])
			const topics = ADD_TOPICS
			const filtered = activeTopic === 'all' ? feed : feed.filter((item) => (item.topic || 'other') === activeTopic)
			const searched =
				applied === ''
					? filtered
					: filtered.filter((item) => displayTitle(item && item.title).toLowerCase().includes(applied.toLowerCase()))
			const visible = searched.slice(0, Math.max(ADD_PAGE_SIZE, limit))
			const more = searched.length > visible.length
			const busy = typeof busyId === 'string' ? busyId : ''
			const listLoading = refreshing === true && visible.length === 0
			const skeletonRows = Array.from({ length: ADD_SKELETON_ROWS }, (_, index) =>
				h(
					'div',
					{ className: 'dsh-de-skrow', key: `sk-${index}` },
					h('span', { className: 'dsh-de-sk dsh-de-sk-dot' }),
					h('span', { className: 'dsh-de-sk dsh-de-sk-title', style: { width: `${44 + (index % 4) * 9}%` } }),
					h('span', { className: 'dsh-de-sk dsh-de-sk-meta' }),
					h('span', { className: 'dsh-de-sk dsh-de-sk-plus' }),
				),
			)
			const trimmed = query.trim()
			const urlMode = isHttpUrl(trimmed)
			const suggestion = trimmed !== '' && trimmed !== applied ? (urlMode ? 'url' : 'search') : ''
			// A row shows a check when that article is already in the book, at any
			// level: the dialog chose one level when it was added.
			const inBook = useMemo(() => {
				const byId = new Map()
				const byUrl = new Map()
				for (const unit of saved) {
					if (!unit || !CEFR_LEVELS.includes(unit.cefr)) continue
					if (typeof unit.id === 'string' && unit.id !== '' && !byId.has(unit.id)) byId.set(unit.id, unit.cefr)
					if (unit.source && typeof unit.source.url === 'string' && unit.source.url !== '' && !byUrl.has(unit.source.url)) {
						byUrl.set(unit.source.url, unit.cefr)
					}
				}
				return { byId, byUrl }
			}, [saved])
			const okSources = Array.isArray(status) ? status.filter((entry) => entry && entry.ok === true).length : 0
			const badSources = Array.isArray(status) ? status.filter((entry) => entry && entry.ok !== true).length : 0
			const topicLabel = (id) => {
				const key = `topic.${id}`
				const label = t(key)
				return label === key ? id : label
			}

			const closePicker = () => {
				setPicking(null)
			}

			const openPicker = (item) => {
				if (busy !== '') return
				setChoice(defaultLevel)
				setPicking(item)
			}

			const applySearch = (value = trimmed) => {
				const next = String(value ?? '').trim()
				if (next === '' || isHttpUrl(next)) return
				setApplied(next)
			}

			const ingestUrl = async (value = trimmed) => {
				const target = String(value ?? '').trim()
				if (!isHttpUrl(target) || ingesting) return
				setIngesting(true)
				try {
					const item = typeof props.onIngestUrl === 'function' ? await props.onIngestUrl(target) : null
					if (item) {
						setChoice(defaultLevel)
						setPicking(item)
						setQuery('')
						setApplied('')
					}
				} catch (error) {
					const code = error && typeof error.code === 'string' ? error.code : ''
					showToast(t(code === 'no-article-text' ? 'add.noText' : 'add.customFailed'), 'warning')
				} finally {
					setIngesting(false)
				}
			}

			const onSearchKey = (event) => {
				if (!event || typeof event.key !== 'string') return
				if (event.key === 'Enter') {
					if (typeof event.preventDefault === 'function') event.preventDefault()
					if (urlMode) void ingestUrl()
					else applySearch()
				} else if (event.key === 'Escape') {
					if (typeof event.preventDefault === 'function') event.preventDefault()
					setQuery('')
					setApplied('')
				}
			}

			const searchBox = h(
				'div',
				{ className: 'dsh-de-searchbox' },
				h('span', { className: 'dsh-de-searchico' }, h(SearchGlyph, { size: 16 })),
				h('input', {
					type: 'text',
					className: 'dsh-de-searchinput',
					value: query,
					placeholder: t('add.searchPlaceholder'),
					'aria-label': t('add.searchPlaceholder'),
					onChange: (event) => setQuery(event && event.target ? String(event.target.value) : ''),
					onKeyDown: onSearchKey,
				}),
				trimmed !== ''
					? h(
							'button',
							{
								type: 'button',
								className: 'dsh-de-searchclear',
								title: t('add.clear'),
								'aria-label': t('add.clear'),
								onClick: () => {
									setQuery('')
									setApplied('')
								},
							},
							h(CloseGlyph),
						)
					: null,
				suggestion !== ''
					? h(
							'div',
							{ className: 'dsh-de-searchsuggest' },
							h(
								'button',
								{
									type: 'button',
									className: 'dsh-de-searchrow',
									disabled: ingesting,
									onClick: () => {
										if (urlMode) void ingestUrl()
										else applySearch()
									},
								},
								urlMode ? h(PlusGlyph, { size: 13 }) : h(SearchGlyph, { size: 14 }),
								h('span', { className: 'dsh-de-searchrow-text' }, ingesting && urlMode ? t('add.loading') : trimmed),
							),
						)
					: null,
			)

			const dialog =
				picking === null
					? null
					: h(LevelDialog, {
							t,
							item: picking,
							value: choice,
							myLevel: defaultLevel,
							busy: busy !== '',
							modelName,
							settings,
							tts,
							onSettings,
							onChange: setChoice,
							onConfirm: (level) => {
								if (busy !== '' || typeof props.onAdd !== 'function') return
								props.onAdd(picking, level)
								closePicker()
							},
							onCancel: closePicker,
						})

			const chip = (id, label, count, selected) =>
				h(
					'button',
					{
						type: 'button',
						key: id,
						className: selected ? 'dsh-de-chip dsh-de-chip-on' : 'dsh-de-chip',
						'aria-pressed': selected ? 'true' : 'false',
						onClick: () => {
							if (typeof props.onTopic === 'function' && selected !== true) props.onTopic(id)
						},
					},
					label,
					h('span', { className: 'dsh-de-chip-count' }, String(count)),
				)

			const tools = h(
				'div',
				{ className: 'dsh-de-addtools' },
				h(
					'div',
					{ className: 'dsh-de-chips' },
					chip('all', t('topic.all'), feed.length, activeTopic === 'all'),
					topics.map((id) => chip(id, topicLabel(id), topicCounts.get(id) || 0, activeTopic === id)),
				),
			)

			// Source health sits next to refresh: it describes the list as a whole,
			// so it belongs to the toolbar that reloads it, not to the topic chips.
			// Before the first poll there is no status to report; a literal "0 sources"
			// during the skeleton would be a lie. The empty span still keeps refresh
			// at the far right.
			const sourceHealth = h(
				'span',
				{
					className: 'dsh-de-srchint',
					title: Array.isArray(status) ? status.map((entry) => `${entry.label}: ${entry.ok ? 'ok' : entry.error || 'down'}`).join('\n') : '',
				},
				Array.isArray(status) && status.length > 0 ? t('add.sourcesOk', { n: okSources }) : '',
				badSources > 0 ? ` · ${t('add.sourcesPartial', { n: badSources })}` : '',
			)

			const rows = visible.map((item) => {
				// The unit id is the article URL's hash, so the book can be matched
				// by id first; units generated before that rule still match by URL.
				const addedAt = inBook.byId.get(item.id) || inBook.byUrl.get(item.url) || ''
				const adding = busy !== '' && busy === item.id
				const age = ageText(item.publishedAt, t)
				const unread = item.read !== true && addedAt === ''
				const metaChildren = []
				// The favicon already names the source; the grey meta is topic · age,
				// with the unread marker sitting just before the topic.
				if (unread) metaChildren.push(h('span', { className: 'dsh-de-unread', 'aria-hidden': 'true' }))
				if (item.topic) metaChildren.push(h('span', { className: 'dsh-de-addmeta-topic' }, topicLabel(item.topic)))
				if (age !== '') {
					if (metaChildren.length > 0) metaChildren.push(' · ')
					metaChildren.push(h('span', { className: 'dsh-de-addmeta-age' }, age))
				}
				const licenseTitle = item.license && item.license.label
					? `${item.license.label}${item.attribution && item.attribution.label ? ` · ${item.attribution.label}` : ''}`
					: ''
				return h(
					'div',
					{ className: 'dsh-de-addrow', key: item.id || item.url, 'data-read': item.read === true ? 'true' : 'false' },
					h(SourceIcon, { provider: item.provider, label: item.source }),
					h(
						'span',
						{ className: 'dsh-de-addrow-title', title: licenseTitle ? `${displayTitle(item.title)}\n${licenseTitle}` : displayTitle(item.title) },
						displayTitle(item.title),
					),
					h(
						'a',
						{
							className: 'dsh-de-openlink',
							href: item.url,
							target: '_blank',
							rel: 'noopener noreferrer',
							title: t('add.openSource'),
							'aria-label': t('add.openSource'),
							onClick: (event) => {
								if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
							},
						},
						h(ArrowRightGlyph, { size: 12 }),
					),
					metaChildren.length > 0 ? h('span', { className: 'dsh-de-addmeta' }, ...metaChildren) : null,
					addedAt !== ''
						? h(
								'span',
								{ className: 'dsh-de-adddone', title: t('add.addedAt', { level: addedAt }), 'aria-label': t('add.addedAt', { level: addedAt }) },
								h(CheckGlyph, { size: 19 }),
							)
						: h(
								'button',
								{
									type: 'button',
									className: adding ? 'dsh-de-addcircle dsh-de-addcircle-busy' : 'dsh-de-addcircle',
									title: adding ? t('add.adding', { level: choice }) : t('add.chooseLevel'),
									'aria-label': t('add.chooseLevel'),
									disabled: busy !== '',
									onClick: () => openPicker(item),
								},
								adding
									? h('span', { className: 'dsh-de-spinner', 'aria-hidden': 'true' })
									: h(PlusGlyph, { size: 13 }),
							),
				)
			})

			return h(
				'div',
				{ className: 'dsh-de-page' },
				h(
					'div',
					{ className: 'dsh-de-addwrap' },
					h(
						'header',
						{ className: 'dsh-de-addhead' },
						h(
							'button',
							{
								type: 'button',
								className: 'dsh-de-icobtn dsh-de-icobtn-ghost',
								title: t('add.back'),
								'aria-label': t('add.back'),
								onClick: () => {
									if (typeof props.onBack === 'function') props.onBack()
								},
							},
							h(BackGlyph, null),
						),
						h('h1', { className: 'dsh-de-addtitle' }, t('add.title')),
						sourceHealth,
						h(
							'button',
							{
								type: 'button',
								className: 'dsh-de-icobtn dsh-de-icobtn-ghost',
								title: t('add.refresh'),
								'aria-label': t('add.refresh'),
								disabled: refreshing === true,
								onClick: () => {
									if (refreshing === true || typeof props.onRefresh !== 'function') return
									props.onRefresh()
								},
							},
							h(RefreshGlyph, null),
						),
					),
					searchBox,
					tools,
					h(
						'div',
						{ className: 'dsh-de-addlist' },
						visible.length === 0
							? listLoading
								? skeletonRows
								: h(
										'div',
										{ className: 'dsh-de-addempty' },
										applied !== ''
											? t('add.searchEmpty')
											: activeTopic === 'all'
												? t('add.empty')
												: t('add.emptyTopic'),
									)
							: rows,
						!listLoading && more
							? h(
									'button',
									{
										type: 'button',
										className: 'dsh-de-addmore',
										onClick: () => setLimit((value) => value + ADD_PAGE_SIZE),
									},
									t('add.loadingMore'),
								)
							: null,
					),
					dialog,
				),
			)
		}

		/* ───────────────────────────── Article sentence ───────────────────────────── */

		/**
		 * One article sentence as per-word boxes: one box per word (width = letters),
		 * Space moves to the next box, Enter checks, a wrong word gets a red underline
		 * and the focus returns to the first wrong box. Punctuation is printed, never
		 * typed.
		 * @param {object} props - page props.
		 * @returns {object} element.
		 */
		function ArticleSentence(props) {
			const { t, sentence, zh, given, index, total, onNext, onResult, onReplay, onPhase, listening, onStartTyping, resumeResult, draft, unitId, onDraft, sound } = props
			const units = useMemo(() => sentenceUnits(sentence, given), [sentence, given])
			// Proper nouns (names, companies, places) are printed, not typed, so the
			// editable boxes are a filtered view of the sentence's units.
			const editable = useMemo(() => {
				const list = []
				units.forEach((unit, at) => {
					if (!unit.given) list.push(at)
				})
				return list
			}, [units])
			const positionOf = useMemo(() => {
				const map = new Map()
				editable.forEach((at, position) => map.set(at, position))
				return map
			}, [editable])
			const resumedWords = resumeResult && Array.isArray(resumeResult.words) ? resumeResult.words : null
			const restoredDraft =
				draft && draft.index === index && (draft.unitId === undefined || draft.unitId === unitId) ? draft : null
			const savedAttempts = restoredDraft && Array.isArray(restoredDraft.attempts) ? restoredDraft.attempts : null
			const [answers, setAnswers] = useState(() =>
				units.map((unit, at) => (restoredDraft && Array.isArray(restoredDraft.answers) ? String(restoredDraft.answers[at] ?? '') : '')),
			)
			const [wrong, setWrong] = useState(() => (restoredDraft && Array.isArray(restoredDraft.wrong) ? restoredDraft.wrong : []))
			const [attempts, setAttempts] = useState(() =>
				units.map((unit, at) => {
					if (unit.given) return 0
					if (savedAttempts && at < savedAttempts.length) {
						const fromDraft = Number(savedAttempts[at])
						if (Number.isFinite(fromDraft) && fromDraft > 0) return fromDraft
					}
					const saved = resumedWords && resumedWords[at] ? Number(resumedWords[at].attempts) : 0
					return Number.isFinite(saved) && saved > 0 ? saved : 0
				}),
			)
			// '' typing · 'no' wrong · 'ok' accepted (the result screen)
			const [mark, setMark] = useState(() => (restoredDraft ? restoredDraft.mark || '' : resumedWords ? 'ok' : ''))
			const [focusIndex, setFocusIndex] = useState(() => (restoredDraft && Number.isInteger(restoredDraft.focusIndex) ? restoredDraft.focusIndex : 0))
			const [peekUnit, setPeekUnit] = useState(null)
			const peekCaret = useRef(null)
			const [peeks, setPeeks] = useState(() => units.map(() => 0))
			const peekStats = useRef(units.map(() => ({ beforeInput: 0, afterWrong: 0, onCorrect: 0 })))
			const firstTryAnswers = useRef(units.map(() => null))
			// The last wrong answer each word was checked with; used so the same
			// mistake submitted twice is one error, not two.
			const lastWrongAnswers = useRef(
				units.map((unit, at) =>
					unit.given || !restoredDraft || !Array.isArray(restoredDraft.lastWrong) || typeof restoredDraft.lastWrong[at] !== 'string'
						? null
						: restoredDraft.lastWrong[at],
				),
			)
			const boxRefs = useRef([])
			const layout = useMemo(() => underlineLayout(units.map((unit) => unit.plain)), [units])
			const fontPx = Math.min(32, Math.max(16, Math.floor(1400 / Math.max(1, layout.total))))
			const done = mark === 'ok'

			const focusBox = (at, caret = 'end') => {
				const box = boxRefs.current[at]
				if (!box || typeof box.focus !== 'function') return
				box.focus({ preventScroll: true })
				const value = String(box.value ?? '')
				const spot = caret === 'start' ? 0 : value.length
				try {
					box.setSelectionRange(spot, spot)
				} catch (error) {
					/* the caret is a nicety; focus is the requirement */
				}
			}

			useEffect(() => {
				if (listening) return
				if (typeof onPhase === 'function') onPhase(done ? 'result' : 'typing')
			}, [done, listening, onPhase])

			// While the sentence is being spoken the boxes are hidden; Enter/Space
			// starts writing and the page clock.
			useEffect(() => {
				if (!listening || typeof document === 'undefined') return undefined
				const down = (event) => {
					if (event.repeat) return
					if (event.key !== 'Enter' && event.key !== ' ') return
					event.preventDefault()
					if (typeof onStartTyping === 'function') onStartTyping()
				}
				document.addEventListener('keydown', down, true)
				return () => document.removeEventListener('keydown', down, true)
			}, [listening, onStartTyping])

			// Revealing the boxes moves the caret into the first editable word.
			useEffect(() => {
				if (listening || typeof document === 'undefined') return undefined
				const timer = setTimeout(() => {
					const active = document.activeElement
					if (active && active.tagName === 'INPUT' && boxRefs.current.includes(active)) return
					const position = restoredDraft ? positionOf.get(restoredDraft.focusIndex) : 0
					focusBox(Number.isInteger(position) ? position : 0)
				}, 0)
				return () => clearTimeout(timer)
			}, [listening])

			// Keep the page-level article memory in sync, so a panel/window remount
			// restores the typed answers, attempts, verdict and focused box.
			useEffect(() => {
				if (typeof onDraft !== 'function') return
				onDraft({ unitId, index, answers, wrong, attempts, mark, focusIndex, lastWrong: lastWrongAnswers.current })
			}, [answers, wrong, attempts, mark, focusIndex, index, unitId, onDraft])

			const wordWithBehavior = (unit, at) => {
				const stats = (peekStats.current && peekStats.current[at]) || { beforeInput: 0, afterWrong: 0, onCorrect: 0 }
				return {
					...unit,
					attempts: unit.given ? 0 : attempts[at] || 1,
					typed: unit.given ? '' : String((answers && answers[at]) || ''),
					firstTyped: unit.given ? '' : String(firstTryAnswers.current[at] == null ? '' : firstTryAnswers.current[at]),
					peeks: unit.given ? 0 : peeks[at] || 0,
					peekBeforeInput: unit.given ? 0 : stats.beforeInput,
					peekAfterWrong: unit.given ? 0 : stats.afterWrong,
					peekOnCorrect: unit.given ? 0 : stats.onCorrect,
				}
			}

			// Save the accepted sentence (and its per-word attempts and behavior) the
			// moment the result screen appears, so the summary keeps the diagnosis.
			useEffect(() => {
				if (!done || typeof onResult !== 'function') return
				onResult(units.map((unit, at) => wordWithBehavior(unit, at)))
			}, [attempts, done, onResult, units, peeks])

			// The first box owns the caret on every new sentence. A click that landed
			// before this effect ran wins: never steal a focus the learner just chose.
			useEffect(() => {
				if (typeof document === 'undefined') return undefined
				const timer = setTimeout(() => {
					const active = document.activeElement
					if (active && active.tagName === 'INPUT' && boxRefs.current.includes(active)) return
					const position = restoredDraft ? positionOf.get(restoredDraft.focusIndex) : 0
					focusBox(Number.isInteger(position) ? position : 0)
				}, 0)
				return () => clearTimeout(timer)
			}, [])

			// Pressing Up shows the word of the focused box; release hides it and
			// leaves the caret exactly where it was. Blur and any other key hide it.
			useEffect(() => {
				if (typeof window === 'undefined') return undefined
				const hide = () => {
					peekCaret.current = null
					setPeekUnit(null)
				}
				window.addEventListener('blur', hide)
				return () => window.removeEventListener('blur', hide)
			}, [])

			// Alt/Option toggles speech in both the typing and result screens. The
			// sentence peek is local to the focused input and uses Up instead.
			useEffect(() => {
				if (typeof document === 'undefined') return undefined
				const down = (event) => {
					if (event.repeat) return
					if (!isReplayShortcut(event)) return
					event.preventDefault()
					onReplay()
				}
				document.addEventListener('keydown', down, true)
				return () => document.removeEventListener('keydown', down, true)
			}, [onReplay])

			// The accepted sentence is its own screen; with no input mounted, Enter and
			// Space are read here. The word attempts travel to the summary.
			useEffect(() => {
				if (!done || typeof document === 'undefined') return undefined
				const onKeyDown = (event) => {
					if (event.repeat) return
					if (sentenceResultAction(event) !== 'next') return
					// A focused button keeps its own Enter activation (the back arrow).
					const active = document.activeElement
					if (active && (active.tagName === 'BUTTON' || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
					event.preventDefault()
					onNext(units.map((unit, at) => wordWithBehavior(unit, at)))
				}
				document.addEventListener('keydown', onKeyDown, true)
				return () => document.removeEventListener('keydown', onKeyDown, true)
			}, [attempts, done, onNext, units, peeks])

			const check = () => {
				const flags = units.map((unit, at) => (unit.given ? false : normalizeWord(answers[at]) !== normalizeWord(unit.plain)))
				const firstWrong = flags.findIndex((flag) => flag)
				setWrong(flags)
				// Empty boxes turn red, but they are not scoring errors. A first check
				// only records an answer for words the learner actually typed.
				units.forEach((unit, at) => {
					if (unit.given) return
					const answer = String(answers[at] || '')
					if (answer !== '' && firstTryAnswers.current[at] === null) firstTryAnswers.current[at] = answer
				})
				if (firstWrong === -1) {
					// The successful check is the word's last attempt: attempts = 1
					// for a first-try word, 2 after one distinct wrong answer, etc.
					setAttempts((previous) => previous.map((count, at) => (units[at].given ? 0 : (count || 0) + 1)))
					lastWrongAnswers.current = units.map(() => null)
					setMark('ok')
					return
				}
				const nextLast = [...lastWrongAnswers.current]
				const raised = units.map((unit, at) => {
					if (unit.given || flags[at] !== true) return 0
					const answer = String(answers[at] || '')
					if (answer === '') return 0
					const normalized = normalizeWord(answer)
					if (nextLast[at] === normalized) return 0
					nextLast[at] = normalized
					return 1
				})
				units.forEach((unit, at) => {
					if (!unit.given && flags[at] !== true) nextLast[at] = null
				})
				setAttempts((previous) => previous.map((count, at) => (units[at].given ? 0 : (count || 0) + raised[at])))
				lastWrongAnswers.current = nextLast
				setMark('no')
				if (sound && typeof sound.wrong === 'function') sound.wrong()
				focusBox(positionOf.get(firstWrong) ?? 0)
			}

			const submit = () => {
				if (done) {
					onNext(units.map((unit, at) => ({ ...unit, attempts: unit.given ? 0 : attempts[at] || 1 })))
					return
				}
				check()
			}

			const onKey = (position, event) => {
				if (typingLetter(event) && sound && typeof sound.key === 'function') sound.key()
				// Up peeks at the focused box's word immediately. Every Up (including key
				// repeat) is prevented so holding it never moves the caret; only the
				// first press counts as one mistake. Any other key hides the peek.
				if (event.key === 'ArrowUp' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
					event.preventDefault()
					if (!event.repeat) {
						const box = event.currentTarget || event.target
						peekCaret.current = box
							? { position, start: box.selectionStart, end: box.selectionEnd }
							: null
						const unitAt = editable[position]
						setPeekUnit(unitAt)
						const alreadyRight = matchesTarget(answers[unitAt], units[unitAt] ? units[unitAt].plain : '')
						const stats = peekStats.current[unitAt]
						if (stats) {
							if (String(answers[unitAt] || '') === '') stats.beforeInput += 1
							if ((attempts[unitAt] || 0) > 0) stats.afterWrong += 1
							if (alreadyRight) stats.onCorrect += 1
						}
						setPeeks((previous) => previous.map((count, spot) => (spot === unitAt ? count + 1 : count)))
					}
					return
				}
				if (event.key !== 'ArrowUp') {
					peekCaret.current = null
					setPeekUnit(null)
				}
				// Arabic numerals are printed, never typed: a digit key in a word box is
				// swallowed (and makes no click). Modifier shortcuts stay untouched.
				if (!event.metaKey && !event.ctrlKey && !event.altKey && /^[0-9]$/u.test(String(event.key || ''))) {
					event.preventDefault()
					return
				}
				const box = event.currentTarget || event.target
				const move = arrowDestination(
					{
						key: event.key,
						selectionStart: box ? box.selectionStart : -1,
						selectionEnd: box ? box.selectionEnd : -1,
						shiftKey: event.shiftKey === true,
						metaKey: event.metaKey === true,
						ctrlKey: event.ctrlKey === true,
						altKey: event.altKey === true,
						isComposing: event.isComposing === true,
					},
					String(answers[editable[position]] ?? '').length,
					position > 0,
					position + 1 < editable.length,
				)
				if (move === 'previous' || move === 'next') {
					event.preventDefault()
					focusBox(position + (move === 'next' ? 1 : -1), move === 'next' ? 'start' : 'end')
					return
				}
				if (event.key === ' ' || event.key === 'Spacebar') {
					event.preventDefault()
					if (position + 1 >= editable.length) submit()
					else focusBox(position + 1)
					return
				}
				if (event.key === 'Enter') {
					event.preventDefault()
					submit()
					return
				}
				if (event.key === 'Backspace' && String(answers[editable[position]] ?? '') === '' && position > 0) {
					event.preventDefault()
					focusBox(position - 1)
				}
			}

			const change = (at, value) => {
				setAnswers((previous) => previous.map((entry, spot) => (spot === at ? value : entry)))
				if (wrong[at]) setWrong((previous) => previous.map((flag, spot) => (spot === at ? false : flag)))
				if (mark !== '') setMark('')
			}

			if (listening) {
				return h(
					'div',
					{ className: 'dsh-de-listen' },
					h('div', { className: 'dsh-de-listen-translation' }, zh || t('sentence.listenPrompt')),
				)
			}

			if (done) {
				return h(
					'div',
					{ className: 'dsh-de-sentence-result' },
					h(
						'div',
						{ className: 'dsh-de-result-grid' },
						units.map((unit, at) => {
							if (unit.given) {
								return h(
									'span',
									{ className: 'dsh-de-result-given', key: `${at}-${unit.raw}` },
									unit.prefix ? h('span', { className: 'dsh-de-result-punct' }, unit.prefix) : null,
									unit.display,
									unit.suffix ? h('span', { className: 'dsh-de-result-punct' }, unit.suffix) : null,
								)
							}
							const count = attempts[at] || 1
							return h(
								'div',
								{ className: 'dsh-de-result-item', key: `${at}-${unit.raw}` },
								h('div', { className: 'dsh-de-result-count' }, `X${count}`),
								h(
									'div',
									{ className: 'dsh-de-result-body' },
									unit.prefix ? h('span', { className: 'dsh-de-result-punct' }, unit.prefix) : null,
									h('span', { className: 'dsh-de-result-chip', 'data-tone': count > 1 ? 'warn' : 'good' }, unit.display),
									unit.suffix ? h('span', { className: 'dsh-de-result-punct' }, unit.suffix) : null,
								),
							)
						}),
					),
					zh ? h('div', { className: 'dsh-de-result-zh' }, zh) : null,
				)
			}

			return h(
				'div',
				{ className: 'dsh-de-article-sentence' },
				h(
					'div',
					{ className: 'dsh-de-boxes', style: { fontSize: `${fontPx}px`, gap: 'calc(4px + 0.8em) 16px' } },
					units.map((unit, at) => {
						const prefix = unit.prefix ? h('span', { className: 'dsh-de-punct', style: { alignSelf: 'flex-end' } }, unit.prefix) : null
						const suffix = unit.suffix ? h('span', { className: 'dsh-de-punct', style: { alignSelf: 'flex-end' } }, unit.suffix) : null
						if (unit.given) {
							return h(
								'span',
								{ className: 'dsh-de-wordcell', key: `${at}-${unit.raw}`, style: { flexDirection: 'row', alignItems: 'flex-end', gap: 0 } },
								prefix,
								h('span', { className: 'dsh-de-given' }, unit.display),
								suffix,
							)
						}
						const position = positionOf.get(at) ?? 0
						const filled = String(answers[at] ?? '') !== ''
						const targetLength = Math.max(1, unit.plain.length)
						const typedLength = Array.from(String(answers[at] ?? '')).length
						return h(
							'span',
							{ className: 'dsh-de-wordcell', key: `${at}-${unit.raw}`, style: { flexDirection: 'row', alignItems: 'flex-end', gap: 0, position: 'relative' } },
							prefix,
							h(
								'span',
								{ className: 'dsh-de-boxwrap' },
								h(
									'span',
									{ className: 'dsh-de-dotlayer', 'aria-hidden': 'true', 'data-peek': peekUnit === at ? 'true' : 'false' },
									Array.from({ length: targetLength }, (_, dot) =>
										h('span', { className: 'dsh-de-dot', key: dot, 'data-hidden': dot < typedLength ? 'true' : 'false' }),
									),
								),
								h('input', {
								ref: (element) => {
									boxRefs.current[position] = element
								},
								className: 'dsh-de-box',
								type: 'text',
								value: answers[at] ?? '',
								autoComplete: 'off',
								autoCorrect: 'off',
								autoCapitalize: 'off',
								spellCheck: false,
								autoFocus: position === 0,
								'aria-label': t('sentence.wordAria', { n: at + 1 }),
								'data-state': wrong[at] ? 'wrong' : 'idle',
								style: {
									width: `${Math.max(1, unit.plain.length, String(answers[at] ?? '').length)}ch`,
									border: 0,
									borderBottom: '2px solid',
									borderBottomColor:
										peekUnit === at
											? 'transparent'
											: wrong[at]
												? 'var(--dsw-alias-state-error-primary, #dc2626)'
												: focusIndex === at
													? 'var(--dsw-alias-brand-primary, #4f6bed)'
													: filled
														? 'var(--dsw-alias-label-primary, #1f2328)'
														: 'var(--dsw-alias-border-l2, rgba(0,0,0,.18))',
									...(peekUnit === at ? { color: 'transparent', caretColor: 'transparent' } : {}),
									borderRadius: 0,
									background: 'transparent',
									outline: 'none',
									position: 'relative',
									zIndex: 1,
									// Always left: an empty box puts the caret in the first
									// character cell, and a full word fills its Nch box anyway.
									textAlign: 'left',
									fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
									fontSize: 'inherit',
									lineHeight: '1.4',
									height: 'auto',
									letterSpacing: 0,
								},
								onChange: (event) => change(at, event.target.value),
								onKeyDown: (event) => onKey(position, event),
								onFocus: () => {
									setFocusIndex(at)
								},
								onKeyUp: (event) => {
									if (event.key !== 'ArrowUp') return
									setPeekUnit(null)
									const saved = peekCaret.current
									const box = boxRefs.current[position]
									if (saved && saved.position === position && box && typeof box.setSelectionRange === 'function') {
										try {
											box.setSelectionRange(saved.start, saved.end)
										} catch (error) {
											/* the caret is a nicety */
										}
									}
									peekCaret.current = null
								},
								onBlur: () => {
									peekCaret.current = null
									setPeekUnit(null)
									setFocusIndex((current) => (current === at ? -1 : current))
								},
							}),
							),
							suffix,
							peekUnit === at
								? h(
										'span',
										{ className: 'dsh-de-peek-inplace', key: `peek-${at}`, 'aria-hidden': 'true' },
										h(
											'span',
											{ className: 'dsh-de-peek-inplace-inner' },
											h('span', { className: 'dsh-de-peek-inplace-word' }, unit.display),
											h('span', { className: 'dsh-de-peek-inplace-line' }),
										),
									)
								: null,
						)
					}),
				),
			)
		}

		/* ───────────────────────────── Article summary ───────────────────────────── */

		/**
		 * The end of an article: every word of every sentence as a small chip (green
		 * first try, amber after retries), the full translation, and the words worth
		 * another pass.
		 * @param {object} props - page props.
		 * @returns {object} element.
		 */
		function ArticleSummary(props) {
			const { t, unit, stats, elapsed, referencePace, coachOpen, onCoach, onBack, onRetry } = props
			const records = useMemo(() => {
				const sentences = unit && Array.isArray(unit.sentences) ? unit.sentences : []
				const list = Array.isArray(stats) ? stats : []
				return sentences.map((sentence, index) => {
					const record = list.find((entry) => Number(entry.index) === index) || list[index]
					if (record && Array.isArray(record.words) && record.words.length > 0) return record
					return {
						en: sentence.en,
						zh: sentence.zh,
						words: sentenceUnits(sentence.en, sentence.given).map((word) => ({ ...word, attempts: 1 })),
					}
				})
			}, [stats, unit])
			const score = useMemo(
				() => (Array.isArray(stats) && stats.length > 0 ? dictationScore(records, { elapsedMs: elapsed, referencePace }) : null),
				[elapsed, records, referencePace, stats],
			)
			const words = useMemo(() => records.flatMap((record) => record.words), [records])
			const translation = (unit && Array.isArray(unit.sentences) ? unit.sentences : [])
				.map((sentence) => String(sentence.zh || ''))
				.filter((line) => line !== '')
				.join('')
			const duration = durationParts(elapsed)
			return h(
				'div',
				{ className: 'dsh-de-page' },
				h(
					'div',
					{ className: 'dsh-de-topbar dsh-de-topbar-plain' },
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-de-icobtn dsh-de-icobtn-ghost',
							title: t('articles.back'),
							'aria-label': t('articles.back'),
							onClick: onBack,
						},
						h(BackGlyph),
					),
					h(
						'div',
						{ className: 'dsh-de-topbar-title', style: { flexDirection: 'row', alignItems: 'center', gap: '8px', minWidth: 0 } },
						h('span', { className: 'dsh-de-topbar-name' }, unit ? unit.title : ''),
						h('span', { className: 'dsh-de-badge', style: { fontSize: '10px', color: '#fff', fontWeight: 650, letterSpacing: '.4px' } }, exerciseCefr(unit)),
						h(SourceLink, {
							key: 'source-link',
							url: (unit && unit.source && unit.source.url) || (unit && unit.link) || '',
							t,
						}),
					),
					typeof onCoach === 'function'
						? h(
								'div',
								{ className: 'dsh-de-topbar-actions' },
								h(CoachButton, { t, open: coachOpen === true, disabled: false, onToggle: onCoach }),
							)
						: null,
				),
				h(
					'div',
					{ className: 'dsh-de-summary-body' },
					h(
						'div',
						{ className: 'dsh-de-summary-inner' },
						score && score.words > 0
							? h(
									'div',
									{ className: 'dsh-de-score-head' },
									h(
										'div',
										{ className: 'dsh-de-score-left' },
										h(
											'div',
											{ className: 'dsh-de-score-title' },
											t('score.heading'),
											h('span', { className: 'dsh-de-score-help', title: t('score.help'), 'aria-label': t('score.help') }, '(?)'),
										),
										h('div', { className: 'dsh-de-score-big' }, String(score.value)),
									),
									h(
										'div',
										{ className: 'dsh-de-score-right' },
										h('div', null, `${t('score.spelling')}：${Math.round(score.raw)}%`),
										h('div', null, `${t('score.fluency')}：${score.comprehension}%`),
									),
								)
							: null,
						h(
							'div',
							{ className: 'dsh-de-summary-text' },
							words.map((word, index) =>
								word.given
									? h(
											'span',
											{ className: 'dsh-de-summary-given', key: `${index}-${word.raw}` },
											word.prefix ? h('span', { className: 'dsh-de-summary-punct' }, word.prefix) : null,
											word.display,
											word.suffix ? h('span', { className: 'dsh-de-summary-punct' }, word.suffix) : null,
										)
									: h(
											'span',
											{ className: 'dsh-de-summary-word', key: `${index}-${word.raw}` },
											word.prefix ? h('span', { className: 'dsh-de-summary-punct' }, word.prefix) : null,
											h('span', { className: 'dsh-de-summary-chip', 'data-tone': Number(word.attempts) > 1 ? 'warn' : 'good' }, word.display),
											word.suffix ? h('span', { className: 'dsh-de-summary-punct' }, word.suffix) : null,
										),
								),
						),
						translation ? h('div', { className: 'dsh-de-summary-zh' }, translation) : null,
						h('div', { className: 'dsh-de-summary-divider' }),
						h(
							'div',
							{ className: 'dsh-de-summary-footer' },
							h(
								'span',
								{ className: 'dsh-de-summary-stat' },
								h(CheckGlyph, { size: 16 }),
								h('span', null, `${t('summary.completed', { n: unit && Array.isArray(unit.sentences) ? unit.sentences.length : 0 })}，${t('summary.elapsed', duration)}`),
							),
							h('button', { type: 'button', className: 'dsh-de-summary-retry', onClick: onRetry }, '↻ ', t('summary.retry')),
						),
					),
				),
			)
		}

		/* ───────────────────────────── Dashboard ───────────────────────────── */

		/**
		 * The first screen: level, streak, today, last run, weak spots, and the one
		 * action that matters.
		 * @param {object} props - page props.
		 * @returns {object} element.
		 */
		function Dashboard(props) {
			const { data, t, starting, start, resume, abandon, chooseBand, openArchive, settings, updateSettings, confirmRestart, setConfirmRestart, ttsVersion, tts, articles, savedArticles, onOpenArticle, onOpenSaved, generatingArticle } = props
			void ttsVersion
			const profile = data && data.profile ? data.profile : { theta: 6, band: '', estimatedBand: 'B1', tags: {}, settings: {} }
			const today = data && data.today ? data.today : { sentences: 0, minutes: 0 }
			const activeRun = data ? data.activeRun : null
			const hasBand = Boolean(profile.band)
			const theta = clamp(Number(profile.theta) || 6, 1, 12)
			const lastRun = data ? data.lastRun : null
			const weak = data && Array.isArray(data.weak) ? data.weak : []
			const bands = ['A2', 'B1', 'B2', 'C1']

			const statCard = h(
				'section',
				{ className: 'dsh-de-card' },
				h(
					'div',
					{ className: 'dsh-de-stats' },
					h(
						'div',
						{ className: 'dsh-de-stat' },
						h('span', { className: 'dsh-de-stat-label' }, t('dash.level')),
						h('span', { className: 'dsh-de-stat-value' }, profile.band || profile.estimatedBand),
					),
					h(
						'div',
						{ className: 'dsh-de-stat' },
						h('span', { className: 'dsh-de-stat-label' }, t('dash.streakLabel')),
						h('span', { className: 'dsh-de-stat-value' }, t('dash.days', { n: data ? data.streak : 0 })),
					),
					h(
						'div',
						{ className: 'dsh-de-stat' },
						h('span', { className: 'dsh-de-stat-label' }, t('dash.todayLabel')),
						h('span', { className: 'dsh-de-stat-value' }, t('dash.sentences', { n: today.sentences })),
					),
					h(
						'div',
						{ className: 'dsh-de-stat' },
						h('span', { className: 'dsh-de-stat-label' }, t('dash.timeLabel')),
						h('span', { className: 'dsh-de-stat-value' }, t('dash.todayMinutes', { minutes: today.minutes })),
					),
					h(
						'div',
						{ className: 'dsh-de-meter' },
						h('div', { className: 'dsh-de-meter-track' }, h('div', { className: 'dsh-de-meter-fill', style: { width: `${(theta / 12) * 100}%` } })),
						h('div', { className: 'dsh-de-hint' }, `${theta.toFixed(1)} / 12`),
					),
				),
			)

			const selfCard = !hasBand
				? h(
						'section',
						{ className: 'dsh-de-card' },
						h('div', { className: 'dsh-de-title', style: { fontSize: '16px' } }, t('dash.selfTitle')),
						h('div', { className: 'dsh-de-hint' }, t('dash.selfDesc')),
						h(
							'div',
							{ className: 'dsh-de-bands' },
							bands.map((band) =>
								h(
									'button',
									{ type: 'button', className: 'dsh-de-band', key: band, disabled: starting, onClick: () => chooseBand(band) },
									h('span', { className: 'dsh-de-band-id' }, band),
									h('span', { className: 'dsh-de-band-theta' }, t(`dash.band.${band}`)),
								),
							),
						),
					)
				: null

			const primary = !hasBand
				? null
				: h(
				'section',
				{ className: 'dsh-de-card', style: { padding: '14px' } },
				activeRun
					? h(
							'div',
							{ style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
							h(
								'button',
								{ type: 'button', className: 'dsh-de-primary', disabled: starting, onClick: resume },
								t('dash.continue', { n: (activeRun.index || 0) + 1 }),
							),
							confirmRestart
								? h(
										'div',
										{ className: 'dsh-de-row' },
										h('span', { className: 'dsh-de-hint' }, t('dash.confirmRestart')),
										h('button', { type: 'button', className: 'dsh-de-secondary', onClick: abandon }, t('dash.confirmYes')),
										h('button', { type: 'button', className: 'dsh-de-link', onClick: () => setConfirmRestart(false) }, t('dash.confirmNo')),
									)
								: h(
										'button',
										{ type: 'button', className: 'dsh-de-link', style: { alignSelf: 'flex-start' }, onClick: () => setConfirmRestart(true) },
										t('dash.restart'),
									),
							)
					: h(
							'button',
							{ type: 'button', className: 'dsh-de-primary', disabled: starting || !hasBand, onClick: start },
							starting ? t('practice.firstGenerating') : t('dash.start'),
						),
			)

			const lastRunCard = lastRun
				? h(
						'section',
						{ className: 'dsh-de-card' },
						h(
							'div',
							{ className: 'dsh-de-row' },
							h('span', { className: 'dsh-de-stat-label' }, t('dash.lastRun')),
							h('span', { className: 'dsh-de-muted' }, dayLabel(lastRun.endedAt || lastRun.startedAt)),
							h('span', { className: 'dsh-de-spacer' }),
							h('span', { className: 'dsh-de-chip' }, `${lastRun.grade}`),
							h('span', { className: 'dsh-de-chip' }, t('dash.accuracy', { value: lastRun.accuracy })),
							h('span', { className: 'dsh-de-chip' }, t('dash.sentences', { n: lastRun.sentences })),
						),
						lastRun.mainIssues && lastRun.mainIssues.length > 0
							? h(
									'div',
									{ className: 'dsh-de-hint', style: { marginTop: '8px' } },
									t('dash.issuesLine', { list: lastRun.mainIssues.map((tag) => t(`tag.${tag}`)).join(' · ') }),
								)
							: null,
					)
				: null

			const weakCard = weak.length > 0
				? h(
						'section',
						{ className: 'dsh-de-card' },
						h('div', { className: 'dsh-de-row', style: { marginBottom: '6px' } }, h('span', { className: 'dsh-de-stat-label' }, t('dash.weak'))),
						weak.map((entry) =>
							h(
								'div',
								{ className: 'dsh-de-tag-row', key: entry.tag },
								h('span', { className: 'dsh-de-tag-name' }, t(`tag.${entry.tag}`)),
								h('span', { className: 'dsh-de-tag-track' }, h('span', { className: 'dsh-de-tag-fill', style: { width: `${Math.round(entry.mastery * 100)}%` } })),
								h('span', { className: 'dsh-de-tag-value' }, entry.mastery.toFixed(2)),
							),
						),
					)
				: null

			const footer = h(
				'div',
				{ className: 'dsh-de-footer' },
				h('button', { type: 'button', className: 'dsh-de-link', onClick: openArchive }, t('dash.archive')),
				h('button', { type: 'button', className: 'dsh-de-link', onClick: props.toggleVoice }, t('dash.voice')),
				h('span', { className: 'dsh-de-spacer' }),
				h('span', { className: 'dsh-de-hint' }, t('dash.hint')),
			)

			return h(
				'div',
				{ className: 'dsh-de-page' },
				h(
					'div',
					{ className: 'dsh-de-wrap' },
					h(
						'header',
						{ className: 'dsh-de-head' },
						h('div', { className: 'dsh-de-title' }, 'English Dictation'),
						h('div', { className: 'dsh-de-subtitle' }, t('app.subtitle')),
					),
					statCard,
					selfCard,
					h('div', { style: { height: '14px' } }),
					primary,
					lastRunCard,
					weakCard,
					props.voicePanel,
					footer,
					h('div', { className: 'dsh-de-hint', style: { marginTop: '10px' } }, `${VERSION}`),
				),
			)
		}

		/* ───────────────────────────── Voice & archive ───────────────────────────── */

		/**
		 * The voice settings panel, shown inline on the Dashboard (no separate page).
		 *
		 * The cloud voice needs no key input: the Host resolves its own
		 * local `say` service, and this panel only reports whether that worked.
		 * @param {object} props - panel props.
		 * @returns {object} element.
		 */
		function VoicePanel(props) {
			const { t, tts, ttsVersion, settings, updateSettings, onPreview, onClose, dialog } = props
			void ttsVersion
			const voices = tts.englishVoices()
			const engine = (settings && settings.engine) || tts.engine() || 'cloud'
			const cloudVoice = (settings && settings.cloudVoice) || tts.cloudVoice() || CLOUD_VOICES[0]
			const cloudReady = tts.cloudReady()
			useEffect(() => {
				void tts.checkCloud()
			}, [tts])
			const ref = useRef(null)
			useEffect(() => {
				if (dialog !== true || typeof document === 'undefined') return undefined
				if (ref.current && typeof ref.current.focus === 'function') ref.current.focus({ preventScroll: true })
				const onKey = (event) => {
					if (event.key === 'Escape') {
						event.preventDefault()
						onClose()
					}
				}
				document.addEventListener('keydown', onKey, true)
				return () => document.removeEventListener('keydown', onKey, true)
			}, [dialog, onClose])
			const selectStyle = {
				flex: '1 1 auto',
				padding: '6px 8px',
				borderRadius: '8px',
				background: 'var(--de-fill, rgba(127,127,127,.08))',
				color: 'var(--dsw-alias-label-primary, #1f2328)',
				border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
				fontFamily: 'inherit',
				fontSize: '13px',
			}
			const systemVoice = (settings && settings.voiceName) || tts.voiceName() || (voices[0] ? voices[0].name : '')
			const cloudUsable = cloudReady === true
			const hasAnyVoice = cloudUsable || voices.length > 0
			// One dropdown for both sources: `cloud:` and `system:` prefixes keep the
			// two persisted settings in sync when the learner picks a row.
			const selectedVoice = cloudUsable && engine === 'cloud' ? `cloud:${cloudVoice}` : voices.length > 0 ? `system:${systemVoice}` : ''
			const usingCloud = selectedVoice.startsWith('cloud:')
			const chooseVoice = (event) => {
				const value = event && event.target ? String(event.target.value) : ''
				if (value.startsWith('cloud:')) updateSettings({ engine: 'cloud', cloudVoice: value.slice('cloud:'.length) })
				else if (value.startsWith('system:')) updateSettings({ engine: 'system', voiceName: value.slice('system:'.length) })
			}
			const cloudOptions = CLOUD_VOICES.map((voice) =>
				h('option', { value: `cloud:${voice}`, key: `cloud:${voice}` }, voice === 'stella' ? t('voice.cloudStella') : t('voice.cloudTide')),
			)
			const systemOptions = voices.map((voice) => h('option', { value: `system:${voice.name}`, key: `system:${voice.name}` }, `${voice.name} (${voice.lang})`))
			const controls = [
				h(
					'div',
					{ className: 'dsh-de-tag-row', key: 'voice' },
					h('span', { className: 'dsh-de-tag-name' }, t('voice.engine')),
					h(
						'select',
						{
							value: selectedVoice,
							onChange: chooseVoice,
							disabled: !hasAnyVoice,
							style: { ...selectStyle, opacity: hasAnyVoice ? 1 : 0.55 },
						},
						h('optgroup', { label: t('voice.engineCloud'), disabled: !cloudUsable }, cloudOptions),
						h('optgroup', { label: t('voice.engineSystem'), disabled: voices.length === 0 }, systemOptions),
						!hasAnyVoice ? h('option', { value: '', disabled: true }, t('voice.unavailable')) : null,
					),
				),
				h(
					'div',
					{ className: 'dsh-de-tag-row', key: 'rate' },
					h('span', { className: 'dsh-de-tag-name' }, usingCloud ? t('voice.rateCloud') : t('voice.rate')),
					h('input', {
						type: 'range',
						min: 0.5,
						max: 2,
						step: 0.05,
						value: clamp(Number(settings && settings.rate) || RATE_NORMAL, 0.5, 2),
						onChange: (event) => updateSettings({ rate: Number(event.target.value) }),
						style: { flex: '1 1 auto' },
					}),
					h('span', { className: 'dsh-de-tag-value' }, (clamp(Number(settings && settings.rate) || RATE_NORMAL, 0.5, 2)).toFixed(2)),
				),
				h(
					'div',
					{ className: 'dsh-de-voice-actions', key: 'actions' },
					h(
						'button',
						{ type: 'button', className: 'dsh-de-secondary', onClick: onPreview, disabled: !hasAnyVoice },
						t('voice.preview'),
					),
					h('button', { type: 'button', className: 'dsh-de-dialog-go', onClick: onClose }, t('voice.confirm')),
				),
			].filter(Boolean)
			if (dialog === true) {
				return h(
					'div',
					{
						className: 'dsh-de-modal',
						role: 'presentation',
						onClick: (event) => {
							if (event && event.target === event.currentTarget) onClose()
						},
					},
					h(
						'div',
						{
							className: 'dsh-de-dialog dsh-de-voicedialog',
							role: 'dialog',
							'aria-modal': 'true',
							'aria-label': t('voice.title'),
							tabIndex: -1,
							ref,
							onClick: (event) => {
								if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
							},
						},
						h(
							'div',
							{ className: 'dsh-de-dialog-head' },
							h('h2', { className: 'dsh-de-dialog-title' }, t('voice.title')),
							h(
								'button',
								{ type: 'button', className: 'dsh-de-dialog-close', title: t('voice.close'), 'aria-label': t('voice.close'), onClick: onClose },
								h(CloseGlyph),
							),
						),
						controls,
					),
				)
			}
			return h(
				'section',
				{ className: 'dsh-de-card' },
				h(
					'div',
					{ className: 'dsh-de-row' },
					h('span', { className: 'dsh-de-stat-label' }, t('voice.title')),
					h('span', { className: 'dsh-de-spacer' }),
					h('button', { type: 'button', className: 'dsh-de-link', onClick: onClose }, t('archive.back')),
				),
				controls,
			)
		}

		/**
		 * The archive: the run history plus the error-tag mastery.
		 * @param {object} props - page props.
		 * @returns {object} element.
		 */
		function Archive(props) {
			const { data, t, onBack, archived, busyId, onRegenerate } = props
			const runs = data && Array.isArray(data.runs) ? data.runs : []
			const removed = Array.isArray(archived) ? archived : []
			const tags = data && data.profile && data.profile.tags ? data.profile.tags : {}
			const totals = data && data.totals ? data.totals : { runs: 0, sentences: 0, minutes: 0 }
			const tagRows = Object.entries(tags).sort((left, right) => left[1] - right[1])
			return h(
				'div',
				{ className: 'dsh-de-page' },
				h(
					'div',
					{ className: 'dsh-de-wrap' },
					h(
						'header',
						{ className: 'dsh-de-head' },
						h('div', { className: 'dsh-de-title' }, t('archive.title')),
						h('button', { type: 'button', className: 'dsh-de-secondary', onClick: onBack }, t('archive.back')),
					),
					h(
						'section',
						{ className: 'dsh-de-card' },
						h('div', { className: 'dsh-de-hint' }, t('archive.stats', { runs: totals.runs, sentences: totals.sentences, minutes: totals.minutes })),
						runListOrEmpty(runs, t),
					),
					h(
						'section',
						{ className: 'dsh-de-card' },
						h('div', { className: 'dsh-de-stat-label', style: { marginBottom: '6px' } }, t('archive.removed')),
						removed.length === 0
							? h('div', { className: 'dsh-de-hint', style: { marginTop: '4px' } }, t('archive.noRemoved'))
							: h(
									'div',
									{ className: 'dsh-de-archlist' },
									removed.map((record) => {
										const level = CEFR_LEVELS.includes(record.cefr) ? record.cefr : '—'
										const can = record.builtin === true || String(record.sourceUrl || (record.source && record.source.url) || record.link || '') !== ''
										const sourceLabel = (record.source && (record.source.label || (record.source.attribution && record.source.attribution.label))) || ''
										return h(
											'div',
											{ className: 'dsh-de-archrow', key: record.id },
											h('span', { className: 'dsh-de-level', 'data-band': cefrBand(record.cefr) }, level),
											h(
												'span',
												{ className: 'dsh-de-archmain' },
												h('div', { className: 'dsh-de-archtitle', title: displayTitle(record.title) }, displayTitle(record.title)),
												h(
													'div',
													{ className: 'dsh-de-archmeta' },
													[sourceLabel, record.removedAt ? dayLabel(record.removedAt) : ''].filter(Boolean).join(' · '),
												),
											),
											h(
												'button',
												{
													type: 'button',
													className: 'dsh-de-secondary',
													disabled: busyId === record.id || !can,
													title: can ? '' : t('archive.noSource'),
													onClick: () => {
														if (can && busyId !== record.id) onRegenerate(record.id)
													},
												},
												busyId === record.id ? t('archive.regenerating') : t('archive.regenerate'),
											),
										)
									}),
								),
					),
					h(
						'section',
						{ className: 'dsh-de-card' },
						h('div', { className: 'dsh-de-stat-label', style: { marginBottom: '6px' } }, t('archive.tags')),
						tagRows.length === 0
							? h('div', { className: 'dsh-de-hint' }, t('archive.noTags'))
							: tagRows.map(([tag, mastery]) =>
									h(
										'div',
										{ className: 'dsh-de-tag-row', key: tag },
										h('span', { className: 'dsh-de-tag-name' }, t(`tag.${tag}`)),
										h('span', { className: 'dsh-de-tag-track' }, h('span', { className: 'dsh-de-tag-fill', style: { width: `${Math.round(clamp(mastery, 0, 1) * 100)}%` } })),
										h('span', { className: 'dsh-de-tag-value' }, mastery.toFixed(2)),
									),
								),
					),
				),
			)
		}

		function runListOrEmpty(runs, t) {
			if (!runs || runs.length === 0) return h('div', { className: 'dsh-de-hint', style: { marginTop: '10px' } }, t('archive.empty'))
			return h(
				'div',
				{ className: 'dsh-de-run-list' },
				runs.map((run) =>
					h(
						'div',
						{ className: 'dsh-de-run-row', key: run.id },
						h('span', { className: 'dsh-de-run-when' }, dayLabel(run.endedAt || run.startedAt)),
						h(
							'span',
							{ className: 'dsh-de-run-main' },
							`${t('dash.sentences', { n: run.sentences })} · ${t('dash.accuracy', { value: run.accuracy })}`,
							run.mainIssues && run.mainIssues.length > 0 ? ` · ${run.mainIssues.map((tag) => t(`tag.${tag}`)).join('/')}` : '',
						),
						h('span', { className: 'dsh-de-run-grade' }, run.grade),
					),
				),
			)
		}

		/* ───────────────────────────── Page ───────────────────────────── */

		/**
		 * The whole plugin page: a router between the Dashboard, the dictation page,
		 * the archive and the blocking voice check.
		 * @param {{tts: object, sound: object}} deps - shared engines.
		 * @returns {Function} page component.
		 */
		/**
		 * Where the page was, kept outside React.
		 *
		 * The main slot renders only the active panel: switching the sidebar tab
		 * unmounts this page, so component state alone cannot survive the round
		 * trip. The Host already stores the run; this remembers the screen.
		 */
		let pageMemory = null
		/** Article-scoped AI teacher threads; retry keeps, another article starts another chat. */
		const coachThreads = new Map()

		/** The article screen that must survive a panel/window remount. */
		let articleMemory = null
		/** The practice screen's own state: step, typed words, verdict. */
		let practiceDraft = null

		/**
		 * The sound-reactive glow at the bottom of the practice page.
		 *
		 * It is visible only while a sentence is being read aloud. Every ~33 ms it
		 * writes `--de-glow` on its own node from `tts.analyser()` (bass + low-mid
		 * energy); the CSS layers rise and brighten with it. With no analyser — the
		 * system voice, or a browser without `captureStream` — a slow synthetic
		 * pulse keeps the same rhythm, so the page still breathes instead of
		 * freezing. It never re-renders per frame.
		 * @param {object} props - the TTS instance.
		 * @returns {object} element.
		 */
		function SoundGlow(props) {
			const { tts } = props
			const [active, setActive] = useState(false)
			const host = useRef(null)
			useEffect(() => {
				if (typeof window === 'undefined' || !tts || typeof tts.subscribe !== 'function') return undefined
				let frame = 0
				let phase = 0
				let last = 0
				const paint = (time) => {
					if (frame === 0) return
					frame = window.requestAnimationFrame(paint)
					if (typeof time === 'number' && time - last < 33) return
					last = typeof time === 'number' ? time : last + 33
					const node = host.current
					if (!node) return
					let level = 0
					const info = typeof tts.analyser === 'function' ? tts.analyser() : null
					if (info && info.node && info.bins) {
						info.node.getByteFrequencyData(info.bins)
						let total = 0
						for (let bin = 1; bin < 18; bin += 1) total += info.bins[bin]
						level = total / (17 * 255)
					}
					if (level < 0.01) {
						phase += 0.24
						level = 0.2 + Math.sin(phase) * 0.07 + Math.sin(phase * 2.7) * 0.04
					}
					node.style.setProperty('--de-glow', Math.max(0.04, Math.min(1, level)).toFixed(3))
				}
				const start = () => {
					if (frame !== 0) return
					frame = window.requestAnimationFrame(paint)
				}
				const stop = () => {
					if (frame !== 0) {
						window.cancelAnimationFrame(frame)
						frame = 0
					}
					if (host.current) host.current.style.setProperty('--de-glow', '0')
				}
				const sync = () => {
					const speaking = typeof tts.isSpeaking === 'function' && tts.isSpeaking() === true
					setActive(speaking)
					if (speaking) start()
					else stop()
				}
				const unsubscribe = tts.subscribe(sync)
				sync()
				return () => {
					if (typeof unsubscribe === 'function') unsubscribe()
					stop()
				}
			}, [tts])
			return h(
				'div',
				{ className: active ? 'dsh-de-glow dsh-de-glow-on' : 'dsh-de-glow', 'aria-hidden': 'true', ref: host },
				h('span', { className: 'dsh-de-glow-a' }),
				h('span', { className: 'dsh-de-glow-b' }),
				h('span', { className: 'dsh-de-glow-c' }),
				h('span', { className: 'dsh-de-glow-d' }),
			)
		}

		function makePage(deps) {
			return function EnglishDictationPage(props) {
				const t = useTranslator(props)
				const hasGloss = (candidate) =>
				Boolean(candidate && Array.isArray(candidate.words) && candidate.words.length > 0) &&
				candidate.words.every((word) => typeof word.zh === 'string' && word.zh !== '')
			const tts = deps.tts
				const sound = deps.sound
				const ttsVersion = useSyncExternalStore(tts.subscribe, tts.getVersion, tts.getVersion)
				const restoredArticle =
					articleMemory && articleMemory.unit && (articleMemory.view === 'sentences' || articleMemory.view === 'summary')
						? articleMemory
						: null
				const [view, setView] = useState(() =>
					restoredArticle ? restoredArticle.view : pageMemory && pageMemory.view === 'practice' ? 'practice' : 'loading',
				)
				const [data, setData] = useState(null)
				const [loadError, setLoadError] = useState('')
				const [notice, setNotice] = useState('')
				const [starting, setStarting] = useState(false)
				const [confirmRestart, setConfirmRestart] = useState(false)
			const [loadingSeconds, setLoadingSeconds] = useState(0)
				const [voiceOpen, setVoiceOpen] = useState(false)
				const [sourceItems, setSourceItems] = useState([])
				const [modelName, setModelName] = useState('')
				const [sourceStatus, setSourceStatus] = useState([])
				const [sourceTopic, setSourceTopic] = useState('all')
				const [savedArticles, setSavedArticles] = useState([])
				/* The exercise book's own counters (time, accuracy, coverage); the Host
				 * derives them from the progress files, so the home never guesses. */
				const [savedSummary, setSavedSummary] = useState(null)
				const [archivedArticles, setArchivedArticles] = useState([])
				const [archiveBusy, setArchiveBusy] = useState('')
				/* The add page: which article is being generated, and what went wrong. */
				const [addBusy, setAddBusy] = useState('')
				const [sourcesBusy, setSourcesBusy] = useState(false)
				const [sentenceUnit, setSentenceUnit] = useState(() => (restoredArticle ? restoredArticle.unit : null))
				const [sentenceIndex, setSentenceIndex] = useState(() => (restoredArticle ? Math.max(0, Number(restoredArticle.index) || 0) : 0))
				const [sentenceBusy, setSentenceBusy] = useState(false)
				const [sentenceStats, setSentenceStats] = useState(() => (restoredArticle && Array.isArray(restoredArticle.stats) ? restoredArticle.stats : []))
				const [resumeResult, setResumeResult] = useState(() => (restoredArticle ? restoredArticle.resumeResult : null))
				const [sentencePhase, setSentencePhase] = useState(() =>
					restoredArticle && restoredArticle.phase === 'result'
						? 'result'
						: restoredArticle && restoredArticle.phase === 'listening'
							? 'listening'
							: 'typing',
				)
				const [practiceElapsed, setPracticeElapsed] = useState(() => (restoredArticle ? Math.max(0, Number(restoredArticle.elapsed) || 0) : 0))
				const timerRef = useRef(null)
				if (timerRef.current === null) {
					timerRef.current = createTimer()
					if (restoredArticle) timerRef.current.set(Math.max(0, Number(restoredArticle.elapsed) || 0))
				}
				const timer = timerRef.current
				const timerValue = () => timer.value()
				const setTimer = (ms) => {
					const value = timer.set(ms)
					setPracticeElapsed(value)
				}
				const pauseTimer = () => {
					const value = timer.pause()
					setPracticeElapsed(value)
					return value
				}
				const [pageVisible, setPageVisible] = useState(() => {
					if (typeof document === 'undefined') return true
					const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
					return !document.hidden && focused
				})
				const lastResultRef = useRef(null)
				const saveExitRef = useRef(null)
				const lastListenKey = useRef('')
				const sentenceStartedAt = useRef(0)
				const sentenceReplays = useRef(0)
				// A result restored with the page must not chime again; the next fresh
				// result must. One-shot, not for the rest of the session.
				const resultSoundSuppressed = useRef(Boolean(restoredArticle && restoredArticle.phase === 'result'))
				const [coachOpen, setCoachOpen] = useState(false)
				const coachAnswer = useMemo(() => {
					const record = lastResultRef.current
					if (!record || !Array.isArray(record.words)) return ''
					return record.words
						.filter((word) => word && !word.given)
						.map((word) => String(word.typed || ''))
						.filter(Boolean)
						.join(' ')
				}, [sentenceIndex, sentencePhase, sentenceUnit])
				const coachAllowed = view === 'summary' || (view === 'sentences' && sentencePhase === 'result')
				useEffect(() => {
					if (!coachAllowed) setCoachOpen(false)
				}, [coachAllowed])
				useEffect(() => {
					setCoachOpen(false)
				}, [sentenceUnit && sentenceUnit.id])

				// A panel/window switch unmounts the page; this memory makes the next
				// mount render the same article screen, sentence, draft and result.
				useEffect(() => {
					if (view === 'home' || view === 'dashboard' || view === 'loading' || view === 'error') {
						articleMemory = null
						return
					}
					if ((view !== 'sentences' && view !== 'summary') || !sentenceUnit) return
					articleMemory = {
						view,
						unit: sentenceUnit,
						index: sentenceIndex,
						stats: sentenceStats,
						resumeResult,
						phase: sentencePhase,
						elapsed: practiceElapsed,
						draft: articleMemory && articleMemory.draft ? articleMemory.draft : null,
					}
				}, [view, sentenceUnit, sentenceIndex, sentenceStats, resumeResult, sentencePhase, practiceElapsed])
				/* Article practice: the loading screen and its failure, so a slow split
				 * and translation never looks like a dead button. */
				const [articleError, setArticleError] = useState('')
				const [articleRetryValue, setArticleRetryValue] = useState(null)
				const articleToken = useRef(0)
				const [run, setRun] = useState(() => (pageMemory && pageMemory.run) || null)
				const [item, setItem] = useState(() => (pageMemory && pageMemory.item) || null)
				const [round, setRound] = useState(() => (pageMemory && pageMemory.round) || 0)
				// Tag practice: the whole home screen is the topic list.
				const [tag, setTag] = useState(() => (pageMemory && pageMemory.tag) || '')
				const [tagBusy, setTagBusy] = useState('')
				/* Why the loading screen stopped: shown in place, with a retry, so a
				 * failed generation never silently returns to the Dashboard. */
				const [generateError, setGenerateError] = useState('')
				const [generateDetail, setGenerateDetail] = useState('')
				const [generateRetry, setGenerateRetry] = useState('next')
				const mounted = useRef(true)

				useEffect(() => {
					mounted.current = true
					return () => {
						mounted.current = false
						if (saveExitRef.current) saveExitRef.current()
						tts.cancel()
					}
				}, [tts])

				// The browser tab is another way to leave: hide freezes and saves the
				// clock, showing the tab again resumes it if the sentence is still typing.
				useEffect(() => {
					if (typeof document === 'undefined') return undefined
					const pause = () => {
						setPageVisible(false)
						if (saveExitRef.current) saveExitRef.current()
					}
					const onVisibility = () => {
						const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true
						const visible = !document.hidden && focused
						setPageVisible(visible)
						if (!visible) pause()
					}
					const onBlur = () => pause()
					const onFocus = () => {
						if (!document.hidden) setPageVisible(true)
					}
					document.addEventListener('visibilitychange', onVisibility)
					window.addEventListener('blur', onBlur)
					window.addEventListener('focus', onFocus)
					return () => {
						document.removeEventListener('visibilitychange', onVisibility)
						window.removeEventListener('blur', onBlur)
						window.removeEventListener('focus', onFocus)
					}
				}, [])

				// A <details> menu does not close itself when the pointer goes
				// elsewhere: close any open one on the next outside press, so a
				// click never lands on a stale panel.
				useEffect(() => {
					if (typeof document === 'undefined') return undefined
					const closeOpenMenus = (event) => {
						const target = event && event.target
						for (const details of document.querySelectorAll('details.dsh-de-menu[open]')) {
							if (target && typeof details.contains === 'function' && details.contains(target)) continue
							details.open = false
						}
					}
					document.addEventListener('pointerdown', closeOpenMenus, true)
					return () => document.removeEventListener('pointerdown', closeOpenMenus, true)
				}, [])

				// The practice clock runs only while a sentence is waiting for typing.
				// The result page, the summary, another view and a hidden tab all pause it.
				useEffect(() => {
					if (!pageVisible || view !== 'sentences' || sentencePhase !== 'typing') {
						pauseTimer()
						return undefined
					}
					timer.resume()
					const tick = () => setPracticeElapsed(timer.value())
					tick()
					const timerId = setInterval(tick, 1000)
					return () => {
						clearInterval(timerId)
						pauseTimer()
					}
				}, [pageVisible, sentencePhase, view, timer])

				const settings = data && data.profile && data.profile.settings
					? data.profile.settings
					: { rate: RATE_NORMAL, sound: true, voiceName: '', engine: 'cloud', cloudVoice: CLOUD_VOICES[0] }

				// One playback per sentence/listening phase; a restored listening screen
				// also gets its audio. Page focus gates autoplay after a window switch.
				useEffect(() => {
					if (view !== 'sentences' || sentencePhase !== 'listening' || !sentenceUnit || !pageVisible) return
					const current = sentenceUnit.sentences[sentenceIndex]
					if (!current) return
					const key = `${sentenceUnit.id}:${sentenceIndex}`
					if (lastListenKey.current === key) return
					lastListenKey.current = key
					tts.speak(current.en, { rate: settings.rate, voiceName: settings.voiceName })
				}, [pageVisible, sentenceIndex, sentencePhase, sentenceUnit, settings.rate, settings.voiceName, tts, view])

				const applyDashboard = useCallback(
					(payload) => {
						if (!payload || !payload.profile) return
						setData(payload)
						const next = payload.profile.settings || {}
						tts.setVoice(next.voiceName || '')
						if (next.engine) tts.setEngine(next.engine)
						if (next.cloudVoice) tts.setCloudVoice(next.cloudVoice)
					},
					[sound, tts],
				)

				useEffect(() => {
					if (view !== 'practice-loading' && view !== 'generating') return undefined
					if (view === 'generating' && generateError !== '') return undefined
					setLoadingSeconds(0)
					const timer = setInterval(() => setLoadingSeconds((value) => value + 1), 1000)
					return () => clearInterval(timer)
				}, [view, generateError])

				/**
				 * Tell the Host what the page actually saw when it gave up.
				 *
				 * Best-effort and silent: diagnostics must never become a second
				 * failure the learner has to deal with.
				 * @param {string} where - the step that failed.
				 * @param {object} error - thrown request error.
				 * @returns {void}
				 */
				const reportError = useCallback((where, error) => {
					void api.clientLog({
						where,
						name: error && typeof error.name === 'string' ? error.name : '',
						code: error && typeof error.code === 'string' ? error.code : '',
						status: error && typeof error.status === 'number' ? error.status : 0,
						message: error && typeof error.message === 'string' ? error.message : '',
					})
				}, [])

				const load = useCallback(async () => {
					try {
						const payload = await api.profile()
						if (!mounted.current) return
						applyDashboard(payload)
						setModelName(typeof payload.model === 'string' ? payload.model : '')
						setLoadError('')
						// A resumed practice/article screen stays; a panel remount must not
						// bounce the learner back to the dashboard.
						if (pageMemory && pageMemory.view === 'practice') return
						if (articleMemory && (articleMemory.view === 'sentences' || articleMemory.view === 'summary')) return
						setView('home')
						// Nothing is generated ahead of the learner: the practice is
						// written when an article is chosen, not while a page is idle.
					} catch (error) {
						if (!mounted.current) return
						reportError('profile', error)
						// A restored article screen keeps working with the default voice
						// settings; a profile fetch failure must not bounce it home.
						if (articleMemory && (articleMemory.view === 'sentences' || articleMemory.view === 'summary')) return
						setLoadError(t('error.network'))
						setView('error')
					}
				}, [applyDashboard, reportError, t])

				useEffect(() => {
					void load()
					// The Host owns the key: ask once whether cloud speech is on offer.
					void tts.checkCloud()
				}, [load, tts])

				// Remember the practice screen while it is on, and forget it on every
				// other screen: coming back from another tab must land where you were,
				// never on a stale sentence.
				useEffect(() => {
					if (view === 'practice' && item && run) {
						pageMemory = { view, item, run, round, tag }
						return
					}
					pageMemory = null
					if (view !== 'practice') practiceDraft = null
				}, [view, item, run, round, tag])

				/**
				 * Wait for a Host reply without waiting forever.
				 *
				 * The timer is a last-resort guard for a wedged request, not the
				 * generation budget: the Host owns that (30 s), and this one is
				 * longer on purpose. Resolves `null` when it expires.
				 * @param {Promise<object>} promise - request.
				 * @returns {Promise<object|null>} reply, or null.
				 */
				const withWait = useCallback((promise) => {
					let timer = null
					const guard = new Promise((resolve) => {
						timer = setTimeout(() => resolve(null), NEXT_WAIT_MS)
					})
					return Promise.race([promise, guard]).finally(() => clearTimeout(timer))
				}, [])

				const reasonOf = useCallback((error) => generateErrorText(t, error), [t])

				/**
				 * Pick up the sentence the Host may already have written.
				 *
				 * A request that died in flight can still have been answered by the
				 * Host; the start route returns the sentence this run already holds
				 * without asking the model again, so a lost response costs nothing.
				 * @returns {Promise<object|null>} recovered sentence, or null.
				 */
				const recoverFromHost = useCallback(async () => {
					try {
						const payload = await withWait(api.start())
						return payload && payload.item ? payload.item : null
					} catch (error) {
						return null
					}
				}, [withWait])

				const openPractice = useCallback(
					async (resumeExisting) => {
						if (starting) return
						if (!tts.canSpeak()) {
							// The page may load before the Host answered /tts/status.
							await tts.checkCloud()
							if (!tts.canSpeak()) {
								setView('voice')
								return
							}
						}
						setStarting(true)
						setNotice('')
						setGenerateError('')
						setGenerateDetail('')
						setGenerateRetry('start')
						// Enter the practice screen (with its header) and show the loading
						// state there while the question is generated.
						setView('generating')
						// Consume the user gesture now; the sentence speaks a moment later.
						tts.unlock()
						sound.resume()
						try {
							const payload = await withWait(api.start())
							if (!mounted.current) return
							if (!payload || !payload.item) {
								// Stay on the loading screen with a retry: the run is not
								// touched by a failed start, so nothing is lost here.
								setGenerateError(t('practice.generateFailed'))
								setGenerateDetail('run/start · empty reply')
								return
							}
							setRun({
								id: payload.runId,
								index: payload.index || 0,
								score: payload.score || 0,
								combo: payload.combo || 0,
								bestCombo: payload.bestCombo || 0,
								grade: payload.grade && payload.grade.grade ? payload.grade.grade : 'C',
								resumed: resumeExisting === true || payload.resumed === true,
							})
							practiceDraft = null
							setItem(payload.item)
							setView('practice')
						} catch (error) {
							if (!mounted.current) return
							reportError('run/start', error)
							setGenerateError(reasonOf(error))
							setGenerateDetail(errorDetailText('run/start', error))
						} finally {
							if (mounted.current) setStarting(false)
						}
					},
					[reasonOf, reportError, settings.sound, sound, starting, t, tts, withWait],
				)

				const refreshSaved = useCallback(async () => {
					try {
						const payload = await api.savedArticles()
						if (!mounted.current) return
						if (payload && Array.isArray(payload.articles)) setSavedArticles(payload.articles)
						if (payload && payload.summary && typeof payload.summary === 'object') setSavedSummary(payload.summary)
					} catch (error) {
						/* the home keeps the counters it already has */
					}
				}, [])

				/**
				 * Reload the aggregated feed list (the add page's refresh button, and
				 * the first load). The old rows stay until the new ones arrive: a
				 * failed refresh must not blank a list that is still usable, and a
				 * source that is unreachable only removes its own rows.
				 * @returns {Promise<void>} completion.
				 */
				const loadArchived = useCallback(async () => {
					try {
						const payload = await api.archivedArticles()
						if (!mounted.current) return
						if (payload && Array.isArray(payload.articles)) setArchivedArticles(payload.articles)
					} catch (error) {
						/* the archive keeps what it has */
					}
				}, [])

				const removeSaved = useCallback(
					async (id) => {
						try {
							await api.removeArticle(id)
							showToast(t('home.removed'), 'success')
							await refreshSaved()
						} catch (error) {
							showToast(t('home.removeFailed'), 'warning')
						}
					},
					[refreshSaved, t],
				)

				const regenerateArchived = useCallback(
					async (id) => {
						if (archiveBusy !== '') return
						setArchiveBusy(id)
						try {
							await api.regenerateArchived(id, settings && settings.engine === 'cloud' ? settings.cloudVoice : '')
							showToast(t('archive.regenerated'), 'success')
							await refreshSaved()
							await loadArchived()
						} catch (error) {
							const code = error && typeof error.code === 'string' ? error.code : ''
							showToast(t(code === 'no-source' ? 'archive.noSource' : 'archive.regenerateFailed'), 'warning')
						} finally {
							if (mounted.current) setArchiveBusy('')
						}
					},
					[archiveBusy, loadArchived, refreshSaved, settings, t],
				)

				const reloadSources = useCallback(async (force = false) => {
					setSourcesBusy(true)
					try {
						const payload = await api.sources(force === true)
						if (payload && Array.isArray(payload.items)) setSourceItems(payload.items)
						if (payload && Array.isArray(payload.status)) setSourceStatus(payload.status)
						return payload
					} catch (error) {
						/* the list stays as it was */
						return null
					} finally {
						if (mounted.current) setSourcesBusy(false)
					}
				}, [])

				useEffect(() => {
					void reloadSources()
					void refreshSaved()
				}, [refreshSaved, reloadSources])

				/** Mark one source article read locally and on the Host. */
				const markSourceRead = useCallback((id) => {
					setSourceItems((previous) => previous.map((row) => (row.id === id ? { ...row, read: true } : row)))
					void api.sourceRead(id)
				}, [])

				const openSavedUnit = useCallback(
					async (id) => {
						if (sentenceBusy) return
						const token = articleToken.current + 1
						articleToken.current = token
						setSentenceBusy(true)
						setNotice('')
						articleMemory = null
						lastListenKey.current = ''
						setArticleError('')
						setArticleRetryValue(id)
						setView('article')
						tts.unlock()
						sound.resume()
						try {
							const payload = await api.articleUnit(id, settings.engine === 'cloud' ? settings.cloudVoice : '')
							if (token !== articleToken.current || !mounted.current) return
							if (!payload || !payload.article || !Array.isArray(payload.article.sentences) || payload.article.sentences.length === 0) {
								setArticleError(t('practice.generateFailed'))
								return
							}
							const unit = payload.article
							if (unit.sentences.some((sentence) => !String(sentence.zh || '').trim())) {
								setArticleError(t('practice.incompleteArticle'))
								return
							}
							const progress = unit.progress && typeof unit.progress === 'object' ? unit.progress : null
							const legacyProgress = progress !== null && progress.phase === undefined
							let phase = !progress
								? 'listening'
								: ['typing', 'result', 'done'].includes(progress.phase)
									? progress.phase
									: 'typing'
							// The old writer only wrote index 0 when the article was finished (no
							// save on open), so migrate that progress file to the ended screen.
							if (legacyProgress && Number(progress.index) === 0) phase = 'done'
							const savedRecords = progress && Array.isArray(progress.records) ? progress.records : []
							const savedCurrent = progress && progress.current && typeof progress.current === 'object' ? progress.current : null
							const legacyIndex = Number.isFinite(Number(unit.progressIndex)) ? Number(unit.progressIndex) : 0
							const savedIndex = progress && Number.isFinite(Number(progress.index)) ? Number(progress.index) : legacyIndex
							const resumeAt = Math.min(Math.max(savedIndex, 0), unit.sentences.length - 1)
							const savedElapsed = progress ? Math.max(0, Number(progress.elapsedMs) || 0) : 0
							setSentenceUnit(unit)
							setSentenceIndex(resumeAt)
							setSentenceStats(savedRecords)
							lastResultRef.current = phase === 'result' ? savedCurrent : null
							setResumeResult(phase === 'result' && savedCurrent ? savedCurrent : null)
							setSentencePhase(phase === 'result' ? 'result' : phase === 'listening' ? 'listening' : 'typing')
							sentenceStartedAt.current = phase === 'typing' ? Date.now() : 0
							sentenceReplays.current = 0
							setTimer(savedElapsed)
							if (phase === 'done') {
								tts.cancel()
								setView('summary')
								return
							}
							setView('sentences')
							tts.prefetch(unit.sentences[resumeAt].en)
							if (unit.sentences[resumeAt + 1]) tts.prefetch(unit.sentences[resumeAt + 1].en)
							if (phase === 'typing') tts.speak(unit.sentences[resumeAt].en, { rate: settings.rate, voiceName: settings.voiceName })
						} catch (error) {
							if (token === articleToken.current && mounted.current) setArticleError(t('practice.generateFailed'))
						} finally {
							if (token === articleToken.current) setSentenceBusy(false)
						}
					},
					[sentenceBusy, settings.cloudVoice, settings.engine, settings.rate, settings.sound, settings.voiceName, sound, t, tts],
				)

				const retryArticle = useCallback(() => {
					if (typeof articleRetryValue !== 'string' || articleRetryValue === '') return
					void openSavedUnit(articleRetryValue)
				}, [articleRetryValue, openSavedUnit])

				/**
				 * Add one feed article to the exercise book.
				 *
				 * Adding is generating: the split and the per-sentence Chinese are
				 * what make it practisable, so the plus waits for the Host like any
				 * other generation. It stays on the add page afterwards — the point
				 * is to fill the book, not to be dropped into a sentence — and the
				 * row flips to a check as soon as the book comes back.
				 * @param {object} article - feed row ({link, title, …}).
				 * @returns {Promise<void>} completion.
				 */
				const addToLibrary = useCallback(
					async (item, level) => {
						if (!item || typeof item.id !== 'string' || item.id === '') return
						if (!CEFR_LEVELS.includes(level)) return
						if (addBusy !== '') return
						setAddBusy(item.id)
						try {
							const payload = await api.sourceGenerate(
								item.id,
								level,
								settings.engine === 'cloud' ? settings.cloudVoice : '',
							)
							if (!mounted.current) return
							if (!payload || !payload.article) {
								showToast(t('add.failedLevel', { level }), 'warning')
								return
							}
							markSourceRead(item.id)
							// The toast is the confirmation that survives the closed dialog.
							showToast(
								t('add.toastAdded', {
									title: String(payload.article.title || '').slice(0, 48),
									level,
								}),
								'success',
							)
							// Remember the learner's own level: the next dialog opens on it.
							try {
								const next = await api.setSettings({ ...settings, cefr: level })
								if (mounted.current) applyDashboard(next)
							} catch (error) {
								/* the exercise is saved; remembering the level can fail */
							}
							await refreshSaved()
						} catch (error) {
							if (!mounted.current) return
							reportError('sources/generate', error)
							const code = error && typeof error.code === 'string' ? error.code : ''
							if (code === 'rewrite-failed') showToast(t('add.failedLevel', { level }), 'warning')
							else if (code === 'no-article-text') showToast(t('add.noText'), 'warning')
							else showToast(t('add.failed'), 'warning')
						} finally {
							if (mounted.current) setAddBusy('')
						}
					},
					[addBusy, applyDashboard, refreshSaved, reportError, settings, t],
				)

				const handleSentenceResult = useCallback(
					(stats) => {
						if (!sentenceUnit || !sentenceUnit.id) return
						const current = sentenceUnit.sentences[sentenceIndex]
						if (!current || !Array.isArray(stats)) return
						const previous = lastResultRef.current && lastResultRef.current.index === sentenceIndex ? lastResultRef.current : null
						const timeMs = sentenceStartedAt.current > 0 ? Math.max(0, Date.now() - sentenceStartedAt.current) : Number(previous && previous.timeMs) || 0
						const replays = sentenceReplays.current > 0 ? sentenceReplays.current : Number(previous && previous.replays) || 0
						const record = { index: sentenceIndex, en: current.en, zh: current.zh, words: stats, timeMs, replays }
						lastResultRef.current = record
						// A live result replays the sentence instead of the old success
						// chime; restoring an old result stays silent.
						const shouldReplay = !resultSoundSuppressed.current && !resumeResult
						resultSoundSuppressed.current = false
						if (shouldReplay) {
							tts.speak(current.en, { rate: settings.rate, voiceName: settings.voiceName })
						}
						void api
							.articleProgress(sentenceUnit.id, {
								index: sentenceIndex,
								phase: 'result',
								records: sentenceStats,
								current: record,
								elapsedMs: timerValue(),
							})
							.catch(() => {})
					},
					[resumeResult, sentenceIndex, sentenceStats, sentenceUnit, settings.rate, settings.voiceName, tts],
				)

				const sentenceNext = useCallback(
					(stats) => {
						if (!sentenceUnit) return
						// The correct-answer replay is tied to this result screen; moving on
						// stops it so it cannot overlap the next sentence.
						tts.cancel()
						const current = sentenceUnit.sentences[sentenceIndex] || { en: '', zh: '' }
						const previous = lastResultRef.current && lastResultRef.current.index === sentenceIndex ? lastResultRef.current : null
						const timeMs = sentenceStartedAt.current > 0 ? Math.max(0, Date.now() - sentenceStartedAt.current) : Number(previous && previous.timeMs) || 0
						const replays = sentenceReplays.current > 0 ? sentenceReplays.current : Number(previous && previous.replays) || 0
						const record = Array.isArray(stats)
							? { index: sentenceIndex, en: current.en, zh: current.zh, words: stats, timeMs, replays }
							: null
						const completed = record ? [...sentenceStats, record] : sentenceStats
						if (record) setSentenceStats(completed)
						sentenceStartedAt.current = 0
						sentenceReplays.current = 0
						lastResultRef.current = null
						if (articleMemory) articleMemory.draft = null
						const elapsedMs = timerValue()
						if (sentenceIndex + 1 >= sentenceUnit.sentences.length) {
							// The article is done: persist the completed state (including the
							// dictation score) so reopening it lands on this summary and the
							// home row can show the saved score.
							const referencePace = referencePaceOf(savedArticles, sentenceUnit.cefr, sentenceUnit.id)
							const finalScore = dictationScore(completed, { elapsedMs, referencePace })
							if (sentenceUnit.id) {
								void api
									.articleProgress(sentenceUnit.id, {
										index: sentenceIndex,
										phase: 'done',
										records: completed,
										current: null,
										elapsedMs,
										score: finalScore,
									})
									.catch(() => {})
							}
							if (sound && typeof sound.congrats === 'function') sound.congrats()
							tts.cancel()
							setPracticeElapsed(elapsedMs)
							setView('summary')
							void refreshSaved()
							return
						}
						const next = sentenceIndex + 1
						if (sentenceUnit.id) {
							void api
								.articleProgress(sentenceUnit.id, {
									index: next,
									phase: 'typing',
									records: completed,
									current: null,
									elapsedMs,
								})
								.catch(() => {})
						}
						setSentenceIndex(next)
						setResumeResult(null)
						setSentencePhase('listening')
						tts.prefetch(sentenceUnit.sentences[next].en)
						if (sentenceUnit.sentences[next + 1]) tts.prefetch(sentenceUnit.sentences[next + 1].en)
					},
					[refreshSaved, savedArticles, sentenceIndex, sentenceStats, sentenceUnit, settings.rate, settings.voiceName, tts],
				)

				const retryArticlePractice = useCallback(() => {
					if (!sentenceUnit) return
					tts.cancel()
					setSentenceIndex(0)
					setSentenceStats([])
					setResumeResult(null)
					lastResultRef.current = null
					lastListenKey.current = ''
					sentenceStartedAt.current = 0
					sentenceReplays.current = 0
					setSentencePhase('listening')
					if (articleMemory) articleMemory.draft = null
					setTimer(0)
					if (sentenceUnit.id) {
						void api
							.articleProgress(sentenceUnit.id, { index: 0, phase: 'typing', records: [], current: null, elapsedMs: 0 })
							.catch(() => {})
					}
					tts.prefetch(sentenceUnit.sentences[0].en)
					if (sentenceUnit.sentences[1]) tts.prefetch(sentenceUnit.sentences[1].en)
					setView('sentences')
					tts.unlock()
				}, [sentenceUnit, tts])

				const replaySentence = useCallback(() => {
					const current = sentenceUnit ? sentenceUnit.sentences[sentenceIndex] : null
					if (!current) return
					// Pause/resume must not call unlock(): that would replace the shared
					// audio element's source with the silent unlock clip.
					if (tts.isSpeaking()) {
						tts.pause()
						return
					}
					if (typeof tts.isPaused === 'function' && tts.isPaused()) {
						tts.resume()
						return
					}
					sentenceReplays.current += 1
					tts.unlock()
					tts.speak(current.en, { rate: settings.rate, voiceName: settings.voiceName })
				}, [sentenceIndex, sentenceUnit, settings.rate, settings.voiceName, tts])

				const startTyping = useCallback(() => {
					if (sentencePhase !== 'listening') return
					tts.cancel()
					sentenceStartedAt.current = Date.now()
					sentenceReplays.current = 0
					setSentencePhase('typing')
				}, [sentencePhase, tts])

				// Leaving the article (back, another tab, a hidden browser tab) saves
				// where the reader was and the clock value. A result page saves the
				// accepted sentence so it can be restored as a result, not as typing.
				const handleSentenceDraft = useCallback(
					(draft) => {
						if (!articleMemory) {
							articleMemory = {
								view: 'sentences',
								unit: sentenceUnit,
								index: sentenceIndex,
								stats: sentenceStats,
								resumeResult,
								phase: sentencePhase,
								elapsed: practiceElapsed,
								draft,
							}
							return
						}
						articleMemory.draft = draft
					},
					[sentenceIndex, sentencePhase, sentenceStats, sentenceUnit, practiceElapsed, resumeResult],
				)

				const saveExit = useCallback(() => {
					if (!sentenceUnit || !sentenceUnit.id || view !== 'sentences') return
					const elapsedMs = timerValue()
					if (articleMemory) articleMemory.elapsed = elapsedMs
					if (sentencePhase === 'result') {
						const current = lastResultRef.current
						if (!current) return
						void api
							.articleProgress(sentenceUnit.id, {
								index: sentenceIndex,
								phase: 'result',
								records: sentenceStats,
								current,
								elapsedMs,
							})
							.catch(() => {})
						return
					}
					void api
						.articleProgress(sentenceUnit.id, {
							index: sentenceIndex,
							phase: 'typing',
							records: sentenceStats,
							current: null,
							elapsedMs,
						})
						.catch(() => {})
				}, [sentenceIndex, sentencePhase, sentenceStats, sentenceUnit, view])
				saveExitRef.current = saveExit

				const handleAnswer = useCallback(
					async (payload) => {
						if (!run) throw new Error('no-run')
						const result = await api.answer({ ...payload, runId: run.id })
						if (mounted.current) {
							setRun((previous) =>
								previous
									? {
											...previous,
											index: typeof result.totalScore === 'number' ? previous.index + 1 : previous.index,
											practiceMs: (Number(previous.practiceMs) || 0) + (Number(payload.elapsedMs) || 0),
											score: typeof result.totalScore === 'number' ? result.totalScore : previous.score,
											combo: typeof result.combo === 'number' ? result.combo : previous.combo,
											bestCombo: typeof result.bestCombo === 'number' ? result.bestCombo : previous.bestCombo,
											grade: result.grade || previous.grade,
										}
									: previous,
							)
						}
						return result
					},
					[run],
				)

				const handleRetryReport = useCallback(async (itemId) => {
					return api.retryReport(itemId)
				}, [])

				const handleSkip = useCallback(async () => {
					try {
						const payload = await withWait(api.next())
						if (payload && payload.item) {
							practiceDraft = null
							setItem(payload.item)
							setRound((value) => value + 1)
							return true
						}
						setNotice(t('practice.generateFailed'))
						return false
					} catch (error) {
						setNotice(reasonOf(error))
						return false
					}
				}, [reasonOf, t, withWait])

				const handleContinue = useCallback(
					async (next) => {
						if (next) {
							setItem(next)
							setRound((value) => value + 1)
							setView('practice')
							return
						}
						// The first screen of the next question is the preview: it shows the
						// loading state until the sentence exists. A failure here stays on
						// this screen with a retry — the run, its score and its queue are
						// all still valid on the Host, so there is nothing to go back for.
						setGenerateError('')
						setGenerateDetail('')
						setGenerateRetry('next')
						setView('generating')
						try {
							let payload = await withWait(api.next())
							if (payload && payload.item && !hasGloss(payload.item)) {
								// A sentence stored by an older build can lack its per-word Chinese:
								// ask once more so the input screen always has its hint. The
								// sentence we already have is kept when this second call fails.
								const again = await withWait(api.next())
								if (again && again.item) payload = again
							}
							if (!mounted.current) return
							if (!payload || !payload.item) {
								setGenerateError(t('practice.generateFailed'))
								setGenerateDetail('run/next · empty reply')
								return
							}
							practiceDraft = null
							setItem(payload.item)
							setRound((value) => value + 1)
							setView('practice')
						} catch (error) {
							if (!mounted.current) return
							reportError('run/next', error)
							if (isTransportFailure(error)) {
								// The response was lost, not refused: the sentence may already
								// exist on the Host, so recover it instead of showing an error.
								const recovered = await recoverFromHost()
								if (!mounted.current) return
								if (recovered) {
									practiceDraft = null
									setItem(recovered)
									setRound((value) => value + 1)
									setView('practice')
									return
								}
							}
							// A finished run cannot hand out another sentence: say so and
							// point at the Dashboard rather than offering a dead retry.
							setGenerateError(reasonOf(error))
							setGenerateDetail(errorDetailText('run/next', error))
						}
					},
					[reasonOf, recoverFromHost, reportError, withWait],
				)

				const handleExit = useCallback(async () => {
					tts.cancel()
					pageMemory = null
					practiceDraft = null
					setGenerateError('')
					setView('home')
					setItem(null)
					setRun(null)
					await load()
				}, [load, tts])

				/**
				 * Open one topic: the Host either resumes the sentence already generated
				 * for it or writes one, and the page enters the normal practice screen.
				 * @param {string} id - category id.
				 * @returns {Promise<void>} completion.
				 */
				const openTag = useCallback(
					async (id) => {
						if (tagBusy !== '') return
						setTagBusy(id)
						setNotice('')
						// Enter the practice screen at once: the loading state lives there,
						// never on the topic card.
						setGenerateError('')
						setGenerateDetail('')
						setTag(id)
						setView('generating')
						try {
							const payload = await withWait(api.practiceNext(id))
							if (!mounted.current) return
							if (!payload || !payload.item) {
								setGenerateError(t('practice.generateFailed'))
								setGenerateDetail('practice/next · empty reply')
								return
							}
							setItem(payload.item)
							setRun({
								id: `tag-${id}`,
								index: 0,
								score: 0,
								combo: 0,
								bestCombo: 0,
								grade: 'C',
								practiceMs: 0,
							})
							setView('practice')
						} catch (error) {
							if (!mounted.current) return
							reportError('practice/next', error)
							setGenerateError(t('practice.generateFailed'))
							setGenerateDetail(reasonOf(error))
						} finally {
							if (mounted.current) setTagBusy('')
						}
					},
					[reasonOf, reportError, t, tagBusy, withWait],
				)

				/**
				 * Score locally (the rules live in this bundle) and report the result so
				 * the Host can update word coverage. No AI review in tag practice.
				 * @param {object} payload - answer from the practice screen.
				 * @returns {Promise<object>} verdict for the page.
				 */
				const handleTagAnswer = useCallback(
					async (payload) => {
						const result = payload.revealed === true ? 'reveal' : resultOf({ hadError: payload.hadError, usedBackspace: payload.usedBackspace })
						const comboBefore = run && Number.isFinite(run.combo) ? run.combo : 0
						const combo = nextCombo(comboBefore, result)
						const points = sentenceScore(result, comboBefore)
						const bestCombo = Math.max((run && run.bestCombo) || 0, combo)
						const results = [...((run && run.results) || []), result].slice(-10)
						const grade = rollingGrade(results).grade
						setRun((previous) =>
							previous
								? {
										...previous,
										index: previous.index + 1,
										score: (previous.score || 0) + points,
										combo,
										bestCombo,
										grade,
										practiceMs: (Number(previous.practiceMs) || 0) + (Number(payload.elapsedMs) || 0),
										results,
									}
								: previous,
						)
						void api.practiceDone({
							tag,
							itemId: payload.itemId,
							result,
							words: Array.isArray(payload.boxes) ? payload.boxes : [],
						})
						return {
							result,
							combo,
							comboBefore,
							score: points,
							totalScore: (run && run.score ? run.score : 0) + points,
							bestCombo,
							grade,
							report: null,
							next: null,
							offline: false,
							mismatch: false,
						}
					},
					[run, tag],
				)

				/**
				 * Next sentence of the same topic.
				 * @returns {Promise<void>} completion.
				 */
				const handleTagNext = useCallback(async () => {
					if (tag === '') return
					setGenerateError('')
					setGenerateDetail('')
					setGenerateRetry('next')
					setView('generating')
					try {
						const payload = await withWait(api.practiceNext(tag))
						if (!mounted.current) return
						if (!payload || !payload.item) {
							setGenerateError(t('practice.generateFailed'))
							setGenerateDetail('practice/next · empty reply')
							return
						}
						practiceDraft = null
						setItem(payload.item)
						setRound((value) => value + 1)
						setView('practice')
					} catch (error) {
						if (!mounted.current) return
						reportError('practice/next', error)
						setGenerateError(reasonOf(error))
						setGenerateDetail(errorDetailText('practice/next', error))
					}
				}, [reasonOf, reportError, t, tag, withWait])

				/**
				 * Leave the topic and refresh its progress.
				 * @returns {Promise<void>} completion.
				 */
				const leaveTag = useCallback(async () => {
					tts.cancel()
					pageMemory = null
					practiceDraft = null
					setItem(null)
					setRun(null)
					setTag('')
					await load()
				}, [load, tts])

				const handleAbandon = useCallback(async () => {
					try {
						await api.finish(true)
					} catch (error) {
						/* clearing the dashboard view is still correct locally */
					}
					setConfirmRestart(false)
					pageMemory = null
					practiceDraft = null
					setGenerateError('')
					setRun(null)
					setItem(null)
					setView('home')
					await load()
				}, [load])

				const chooseBand = useCallback(
					async (band) => {
						setStarting(true)
						try {
							const payload = await api.setBand(band)
							applyDashboard(payload)
							setStarting(false)
							await openPractice(false)
						} catch (error) {
							setStarting(false)
							setNotice(t('error.network'))
						}
					},
					[applyDashboard, openPractice, t],
				)

				const updateSettings = useCallback(
					async (patch) => {
						const next = { ...settings, ...patch }
						if (patch.voiceName !== undefined) tts.setVoice(patch.voiceName)
						if (patch.engine !== undefined) tts.setEngine(patch.engine)
						if (patch.cloudVoice !== undefined) tts.setCloudVoice(patch.cloudVoice)
						setData((previous) =>
							previous && previous.profile
								? { ...previous, profile: { ...previous.profile, settings: { ...previous.profile.settings, ...patch } } }
								: previous,
						)
						try {
							const payload = await api.setSettings(next)
							applyDashboard(payload)
						} catch (error) {
							setNotice(t('error.network'))
						}
					},
					[applyDashboard, settings, sound, t, tts],
				)

				const previewVoice = useCallback(() => {
					tts.unlock()
					tts.speak('I like to eat fresh apples every morning.', {
						rate: clamp(Number(settings.rate) || RATE_NORMAL, 0.5, 2),
						voiceName: settings.voiceName,
					})
				}, [settings, tts])

				/** Footer speed dropdown; Edge changes live, the system voice restarts. */
				const setPracticeRate = useCallback((value) => {
					const rate = clamp(Number(value) || RATE_NORMAL, 0.5, 2)
					if (settings.engine === 'system' && (tts.isSpeaking() || (typeof tts.isPaused === 'function' && tts.isPaused()))) {
						const current = sentenceUnit ? sentenceUnit.sentences[sentenceIndex] : null
						if (current) {
							tts.cancel()
							tts.speak(current.en, { rate, voiceName: settings.voiceName })
						}
					}
					if (typeof tts.setRate === 'function') tts.setRate(rate)
					void updateSettings({ rate })
				}, [sentenceIndex, sentenceUnit, settings.engine, settings.voiceName, tts, updateSettings])

				const voicePanelOpen = voiceOpen
					? h(VoicePanel, {
							t,
							tts,
							ttsVersion,
							settings,
							updateSettings,
							onPreview: previewVoice,
							onClose: () => setVoiceOpen(false),
							dialog: true,
						})
					: null

				/* ---- views ---- */
				if (view === 'home') {
					return h(Home, {
						t,
						data,
						savedArticles,
						summary: savedSummary,
						generatingArticle: sentenceBusy,
						onAddExercise: () => {
								setVoiceOpen(false)
							setView('add')
						},
						onOpenSaved: (id) => void openSavedUnit(id),
						onRemoveSaved: (id) => void removeSaved(id),
						onVoice: () => setVoiceOpen((value) => !value),
						onArchive: () => {
							setVoiceOpen(false)
							setView('archive')
							void loadArchived()
						},
						voicePanel: voicePanelOpen,
						settings,
						updateSettings: (patch) => void updateSettings(patch),
					})
				}

				if (view === 'add') {
					return h(AddExercise, {
						t,
						items: sourceItems,
						status: sourceStatus,
						savedArticles,
						myLevel: settings && CEFR_LEVELS.includes(settings.cefr) ? settings.cefr : 'B1',
						topic: sourceTopic,
						onTopic: setSourceTopic,
						busyId: addBusy,
						refreshing: sourcesBusy,
						onAdd: (item, level) => void addToLibrary(item, level),
						onIngestUrl: (url) => api.ingestSource(url).then((payload) => (payload && payload.item ? payload.item : null)),
						settings,
						tts,
						ttsVersion,
						onSettings: (patch) => void updateSettings(patch),
						modelName,
						onBack: () => {
								setView('home')
						},
						onRefresh: async () => {
							const payload = await reloadSources(true)
							if (payload === null) {
								showToast(t('add.refreshFailed'), 'warning')
								return
							}
							const added = Math.max(0, Number(payload.added) || 0)
							showToast(
								added > 0 ? t('add.refreshAdded', { n: added }) : t('add.refreshNoChange'),
								added > 0 ? 'success' : 'plain',
							)
						},
					})
				}

				if (view === 'loading') {
					return h(
						'div',
						{ className: 'dsh-de-page' },
						h('div', { className: 'dsh-de-wrap' }, h('div', { className: 'dsh-de-hint' }, t('dash.loading'))),
					)
				}

				if (view === 'error') {
					return h(
						'div',
						{ className: 'dsh-de-page' },
						h(
							'div',
							{ className: 'dsh-de-wrap' },
							h('div', { className: 'dsh-de-title' }, 'English Dictation'),
							h('div', { className: 'dsh-de-error', style: { margin: '14px 0' } }, loadError),
							h('button', { type: 'button', className: 'dsh-de-secondary', onClick: () => void load() }, t('common.retry')),
						),
					)
				}

				if (view === 'voice') {
					return h(
						'div',
						{ className: 'dsh-de-page' },
						h(
							'div',
							{ className: 'dsh-de-wrap' },
							h(
								'header',
								{ className: 'dsh-de-head' },
								h('div', { className: 'dsh-de-title' }, 'English Dictation'),
								h('div', { className: 'dsh-de-subtitle' }, t('app.subtitle')),
							),
							h(
								'section',
								{ className: 'dsh-de-card' },
								h('div', { className: 'dsh-de-error', style: { marginBottom: '10px' } }, t('voice.noVoice')),
								h('div', { className: 'dsh-de-hint', style: { marginBottom: '10px' } }, t('voice.cloudMissing')),
								h(
									'div',
									{ className: 'dsh-de-row' },
									h(
										'button',
										{
											type: 'button',
											className: 'dsh-de-secondary',
											onClick: () => {
												tts.refresh()
												void tts.checkCloud().then(() => {
													if (tts.canSpeak()) setView('home')
												})
											},
										},
										t('voice.redetect'),
									),
									h('button', { type: 'button', className: 'dsh-de-link', onClick: () => setView('home') }, t('archive.back')),
								),
								tts.canSpeak()
									? h(
											'div',
											{ className: 'dsh-de-row', style: { marginTop: '12px' } },
											h(
												'button',
												{ type: 'button', className: 'dsh-de-primary', disabled: starting, onClick: () => void openPractice(false) },
												starting ? t('practice.firstGenerating') : t('dash.start'),
											),
										)
									: null,
							),
						),
					)
				}

				if (view === 'generating') {
					return h(
						'div',
						{ className: 'dsh-de-page' },
						h(
							'div',
							{ className: 'dsh-de-topbar' },
							h(
								'button',
								{
									type: 'button',
									className: 'dsh-de-icobtn dsh-de-icobtn-ghost',
									title: t('practice.back'),
									'aria-label': t('practice.back'),
									onClick: () => void (tag !== '' ? leaveTag() : handleExit()),
								},
								h(BackGlyph),
							),
							h('div', { className: 'dsh-de-topbar-title' }, h('b', null, 'English Dictation')),
						),
						generateError !== ''
							? // The request failed or timed out: say so here, with a retry.
								h(
									'div',
									{ className: 'dsh-de-wrap' },
									h('div', { className: 'dsh-de-error', style: { marginTop: '18px', textAlign: 'center' } }, generateError),
									generateDetail !== '' ? h('div', { className: 'dsh-de-form-hint' }, generateDetail) : null,
									h(
										'div',
										{ className: 'dsh-de-row', style: { marginTop: '14px', justifyContent: 'center' } },
										h(
											'button',
											{
												type: 'button',
												className: 'dsh-de-primary',
												onClick: () => {
													if (tag !== '') void handleTagNext()
													else if (generateRetry === 'start') void openPractice(false)
													else void handleContinue(null)
												},
											},
											t('practice.retryGenerate'),
										),
										h('button', { type: 'button', className: 'dsh-de-link', onClick: () => void handleExit() }, t('practice.back')),
									),
								)
							: h(
									'div',
									{ className: 'dsh-de-wrap' },
									h(
										'div',
										{ className: 'dsh-de-hint', style: { marginTop: '18px', fontSize: '16px', textAlign: 'center' } },
										t('practice.generatingTitle'),
										loadingSeconds > 0 ? ` ${loadingSeconds}s` : '',
									),
									h('div', { className: 'dsh-de-skeleton', style: { width: '45%', marginTop: '14px' } }),
									h('div', { className: 'dsh-de-skeleton', style: { width: '30%' } }),
								),
					)
				}

				/* Article practice: generate first, then read one sentence at a time. */
				if (view === 'article') {
					const leaveArticle = () => {
						articleToken.current += 1
						setArticleError('')
						setArticleRetryValue(null)
						setSentenceBusy(false)
						setView('home')
					}
					return h(
						'div',
						{ className: 'dsh-de-page' },
						h(
							'div',
							{ className: 'dsh-de-topbar' },
							h(
								'button',
								{
									type: 'button',
									className: 'dsh-de-icobtn dsh-de-icobtn-ghost',
									title: t('articles.back'),
									'aria-label': t('articles.back'),
									onClick: leaveArticle,
								},
								h(BackGlyph),
							),
							h('div', { className: 'dsh-de-topbar-title' }, h('b', null, 'English Dictation')),
						),
						h(
							'div',
							{ className: 'dsh-de-stage' },
							articleError !== ''
								? h(
										'div',
										{ className: 'dsh-de-center' },
										h('div', { className: 'dsh-de-error', style: { textAlign: 'center' } }, articleError),
										h(
											'div',
											{ className: 'dsh-de-row', style: { marginTop: '14px' } },
											h('button', { type: 'button', className: 'dsh-de-primary', onClick: retryArticle }, t('practice.retryGenerate')),
											h('button', { type: 'button', className: 'dsh-de-link', onClick: leaveArticle }, t('articles.back')),
										),
									)
								: h(
										'div',
										{ className: 'dsh-de-center' },
										h('div', { className: 'dsh-de-hint', style: { fontSize: '16px' } }, t('articles.generating')),
										h('div', { className: 'dsh-de-skeleton', style: { width: '60%', marginTop: '14px' } }),
										h('div', { className: 'dsh-de-skeleton', style: { width: '40%' } }),
									),
						),
					)
				}

				if (view === 'sentences' && sentenceUnit) {
					const current = sentenceUnit.sentences[sentenceIndex] || { en: '', zh: '' }
					const total = sentenceUnit.sentences.length
					const level = exerciseCefr(sentenceUnit)
					const sentencePage = h(
						'div',
						{ className: 'dsh-de-page' },
						h(SoundGlow, { key: 'sound-glow', tts }),
						h(
							'div',
							{ className: 'dsh-de-topbar dsh-de-topbar-plain' },
							h(
								'button',
								{
									type: 'button',
									className: 'dsh-de-icobtn dsh-de-icobtn-ghost',
									title: t('articles.back'),
									'aria-label': t('articles.back'),
									onClick: () => {
										saveExit()
										articleMemory = null
										tts.cancel()
										setSentenceUnit(null)
										setSentenceIndex(0)
										setSentenceStats([])
										setSentencePhase('typing')
										setView('home')
										void refreshSaved()
									},
								},
								h(BackGlyph),
							),
							h(
								'div',
								{ className: 'dsh-de-topbar-title', style: { flexDirection: 'row', alignItems: 'center', gap: '8px', minWidth: 0 } },
								h('span', { className: 'dsh-de-topbar-name' }, sentenceUnit.title),
								h('span', { className: 'dsh-de-badge', style: { fontSize: '10px', color: '#fff', fontWeight: 650, letterSpacing: '.4px' } }, level),
								h(SourceLink, {
									key: 'source-link',
									url: (sentenceUnit.source && sentenceUnit.source.url) || sentenceUnit.link || '',
									t,
								}),
							),
							h(
								'div',
								{ className: 'dsh-de-topbar-actions' },
								h(
									'span',
									{
										className: 'dsh-de-timer-wrap',
										'data-paused': timerRunning(pageVisible, sentencePhase) ? 'false' : 'true',
										title: timerRunning(pageVisible, sentencePhase) ? '' : t('practice.timerPaused'),
									},
									h(ClockGlyph, null),
									h('span', { className: 'dsh-de-timer' }, formatTimer(practiceElapsed)),
								),
								h(CoachButton, {
									t,
									open: coachOpen,
									disabled: sentencePhase !== 'result',
									onToggle: () => setCoachOpen((value) => !value),
								}),
							),
						),
						h(
							'div',
							{ className: 'dsh-de-stage dsh-de-practice-stage' },
							h(
								'div',
								{ className: 'dsh-de-practice-main' },
								h(ArticleSentence, {
									key: sentenceIndex,
									t,
									sentence: current.en,
									zh: current.zh,
									given: current.given,
									index: sentenceIndex,
									total,
									onNext: sentenceNext,
									onResult: handleSentenceResult,
									onReplay: replaySentence,
									onPhase: setSentencePhase,
									listening: sentencePhase === 'listening',
									onStartTyping: startTyping,
									resumeResult: resumeResult && Number(resumeResult.index) === sentenceIndex ? resumeResult : null,
									draft: articleMemory && articleMemory.unit && articleMemory.index === sentenceIndex ? articleMemory.draft : null,
									unitId: sentenceUnit.id,
									onDraft: handleSentenceDraft,
									sound,
								}),
							),
							h(
								'div',
								{ className: 'dsh-de-practice-footer' },
								h(
									'div',
									{ className: 'dsh-de-footer-left' },
									h(
										'button',
										{
											type: 'button',
											className: 'dsh-de-footer-audio',
											'data-tone': sentencePhase === 'result' ? 'result' : 'typing',
											title: t('sentence.replayCommand'),
											'aria-label': t('sentence.replayCommand'),
											onMouseDown: (event) => event.preventDefault(),
											onClick: replaySentence,
										},
										h(Wave, { speaking: tts.isSpeaking() }),
									),
									h(
										'select',
										{
											className: 'dsh-de-footer-speed',
											title: t('sentence.speed'),
											'aria-label': t('sentence.speed'),
											value: String(
												PLAYBACK_RATES.reduce(
													(best, value) =>
														Math.abs(value - (Number(settings.rate) || RATE_NORMAL)) <
														Math.abs(best - (Number(settings.rate) || RATE_NORMAL))
															? value
															: best,
													PLAYBACK_RATES[0],
												),
											),
											onChange: (event) => setPracticeRate(Number(event.target.value)),
										},
										PLAYBACK_RATES.map((rate) =>
											h('option', { value: String(rate), key: rate }, `${rate}x`),
										),
									),
								),
								h(
									'div',
									{ className: 'dsh-de-footer-hint' },
									shortcutHint(sentencePhase === 'listening' ? t('sentence.listenFooter') : sentencePhase === 'result' ? t('practice.resultHint') : t('practice.writeHint')),
								),
								h('div', { className: 'dsh-de-footer-count' }, `${sentenceIndex + 1}/${total}`),
							),
						),
					)
					return h(
						'div',
						{ className: coachOpen ? 'dsh-de-coach-host dsh-de-coach-host-open' : 'dsh-de-coach-host' },
						sentencePage,
						coachOpen && sentencePhase === 'result'
							? h(CoachPanel, {
									key: sentenceUnit.id,
									t,
									unit: sentenceUnit,
									currentIndex: sentenceIndex,
									answer: coachAnswer,
									open: true,
									onClose: () => setCoachOpen(false),
								})
							: null,
					)
				}

				if (view === 'summary' && sentenceUnit) {
					const summaryPage = h(ArticleSummary, {
						t,
						unit: sentenceUnit,
						stats: sentenceStats,
						elapsed: practiceElapsed,
						referencePace: referencePaceOf(savedArticles, sentenceUnit.cefr, sentenceUnit.id),
						coachOpen,
						onCoach: () => setCoachOpen((value) => !value),
						onBack: () => {
							// The article is finished and the learner is leaving, not retrying:
							// drop this article's audio from both the client prefetch cache and
							// the Host's disk cache.
							const texts = sentenceUnit.sentences.map((sentence) => sentence.en)
							tts.cancel()
							if (typeof tts.releaseMany === 'function') tts.releaseMany(texts)
							articleMemory = null
							if (settings.engine === 'cloud' && settings.cloudVoice) {
								void api.ttsClear(texts, settings.cloudVoice).catch(() => {})
							}
							setSentenceUnit(null)
							setSentenceStats([])
							setSentenceIndex(0)
							setView('home')
							void refreshSaved()
						},
						onRetry: retryArticlePractice,
					})
					return h(
						'div',
						{ className: coachOpen ? 'dsh-de-coach-host dsh-de-coach-host-open' : 'dsh-de-coach-host' },
						summaryPage,
						coachOpen
							? h(CoachPanel, {
									key: sentenceUnit.id,
									t,
									unit: sentenceUnit,
									currentIndex: null,
									answer: '',
									open: true,
									onClose: () => setCoachOpen(false),
								})
							: null,
					)
				}

				if (view === 'archive') {
					return h(Archive, {
						data,
						t,
						archived: archivedArticles,
						busyId: archiveBusy,
						onRegenerate: (id) => void regenerateArchived(id),
						onBack: () => setView('home'),
					})
				}

				if (view === 'practice' && item && run) {
					const tagMode = tag !== ''
					return h(Practice, {
						key: `${item.id}-${round}`,
						item,
						run,
						settings,
						t,
						tts,
						sound,
						onAnswer: tagMode ? handleTagAnswer : handleAnswer,
						onContinue: tagMode ? () => void handleTagNext() : handleContinue,
						onSkip: tagMode ? handleTagNext : handleSkip,
						onExit: tagMode ? () => void leaveTag() : handleExit,
						onRetryReport: tagMode ? async () => ({ ok: false, report: null }) : handleRetryReport,
					})
				}

				return h(
					'div',
					null,
					h(Dashboard, {
						data,
						t,
						starting,
						start: () => void openPractice(false),
						resume: () => void openPractice(true),
						abandon: () => void handleAbandon(),
						chooseBand: (band) => void chooseBand(band),
						openArchive: () => setView('archive'),
						settings,
						updateSettings: (patch) => void updateSettings(patch),
						confirmRestart,
						setConfirmRestart,
						ttsVersion,
						tts,
						voicePanel: voicePanelOpen,
						generatingArticle: sentenceBusy,
						toggleVoice: () => setVoiceOpen((value) => !value),
					}),
					notice ? h('div', { className: 'dsh-de-hint', style: { textAlign: 'center', paddingBottom: '10px' } }, notice) : null,
				)
			}
		}

		/* ───────────────────────────── Apply ───────────────────────────── */

		/**
		 * A broken render must not leave a blank panel: show the message instead.
		 */
		class PageErrorBoundary extends React.Component {
			constructor(props) {
				super(props)
				this.state = { error: null }
			}

			static getDerivedStateFromError(error) {
				return { error }
			}

			render() {
				if (this.state.error) {
					const message = String((this.state.error && this.state.error.message) || this.state.error)
					return h(
						'div',
						{ className: 'dsh-de-page' },
						h(
							'div',
							{ className: 'dsh-de-wrap' },
							h('div', { className: 'dsh-de-title' }, 'English Dictation'),
							h('div', { className: 'dsh-de-error', style: { margin: '14px 0' } }, message),
							h(
								'button',
								{ type: 'button', className: 'dsh-de-secondary', onClick: () => window.location.reload() },
								'重新加载 / Reload',
							),
						),
					)
				}
				return this.props.children
			}
		}

		/** Services this client half needs. */
		const inject = ['slots', 'locale']

		/**
		 * Client plugin body: dictionaries, stylesheet, TTS engine, the left-sidebar
		 * row and the central page.
		 * @param {object} ctx - client root context.
		 * @returns {void}
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh: LOCALE_ZH, en: LOCALE_EN }), 'dsh-english-dictation: dictionaries')
			translate = ctx.locale.bind(NS)
			injectStyle()
			try {
				void api.clientLog({ where: 'boot', name: 'version', message: VERSION })
			} catch (error) {
				/* diagnostics are best effort */
			}

			const tts = createTts()
			const sound = createSound()
			ctx.effect(() => {
				tts.init('')
				return () => tts.dispose()
			}, 'dsh-english-dictation: speech synthesis')

			const Page = makePage({ tts, sound })
			const PageView = (props) => h(PageErrorBoundary, null, h(Page, props))
			ctx.effect(
				() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ID, locale: NS }, PageView)),
				'dsh-english-dictation: dictation page',
			)

			const ToastHost = makeToast()
			ctx.effect(
				() =>
					ctx.slots.inject('shell.overlay', () =>
						ctx.slots.register(
							{
								name: 'shell.overlay',
								id: `${ID}-toast`,
								order: 90,
								label: () => translate('add.toastLabel'),
								locale: NS,
							},
							ToastHost,
						),
					),
				'dsh-english-dictation: toast',
			)

			const PanelIcon = makePanelIcon()
			ctx.effect(
				() =>
					ctx.slots.inject('sidebar.panellist', () =>
						ctx.slots.register(
							{
								name: 'sidebar.panellist',
								id: ID,
								order: 26,
								label: () => translate('menu.label'),
								locale: NS,
							},
							PanelIcon,
						),
					),
				'dsh-english-dictation: sidebar row',
			)
		}

		exports.apply = apply
		exports.inject = inject
		exports.__test = {
			ID,
			NS,
			API,
			VERSION,
			NEXT_WAIT_MS,
			generateErrorText,
			errorDetailText,
			resumeFocusIndex,
			/** Test hook: seed or clear the practice draft a remount would read. */
			draft(value) {
				practiceDraft = value
			},
			isTransportFailure,
			LOCALE_ZH,
			LOCALE_EN,
			fill,
			clamp,
			normalizeWord,
			normalizeSentence,
			punctuationOf,
			resultOf,
			multiplier,
			sentenceScore,
			nextCombo,
			outcomeOf,
			rateOf,
			gradeOfRate,
			rollingGrade,
			matchesTarget,
			underlineLayout,
			parseChunks,
			validateParse,
			planOf,
			roleOf,
			wrongWordFlags,
			shortcutOf,
			cardKeyAction,
			wordChunksOf,
			buildSteps,
			articleLevelOf,
			exerciseCefr,
			cefrBand,
			SourceIcon,
			SourceLink,
			CheckedGlyph,
			isHttpUrl,
			SoundGlow,
			CEFR_LEVELS,
			displayTitle,
			ageText,
			homeStats,
			timeStatOf,
			sentenceUnits,
			dictationScore,
			scoreBand,
			referencePaceOf,
			sentenceResultAction,
			isReplayShortcut,
			arrowDestination,
			createTimer,
			typingLetter,
			formatClock,
			formatTimer,
			timerRunning,
			durationParts,
			formatNumber,
			dayLabel,
			createTts,
			createSound,
			showToast,
			dismissToast,
			toastSnapshot,
			makeToast,
			makePage,
			Practice,
			Dashboard,
			Home,
			AddExercise,
			LevelDialog,
			ADD_PAGE_SIZE,
			ArticleSentence,
			ArticleSummary,
			Archive,
			VoicePanel,
			makePanelIcon,
			BASE_SCORE,
			PREFERRED_VOICES,
		}
		return module.exports
	},
})
