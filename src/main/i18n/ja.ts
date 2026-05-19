// 日本語辞書。キーは en.ts と完全に一致させること。
// スタイル：ボタン/メニューは短く、ヒント文は句点で終わる。
// ブランド名（Goblin / GitHub / Finder / Ghostty）は翻訳しない。

import type { DictKey } from '#/main/i18n/en.ts'

export const ja: Record<DictKey, string> = {
  // ---- Menu --------------------------------------------------------------
  'menu.file': 'ファイル',
  'menu.edit': '編集',
  'menu.view': '表示',
  'menu.window': 'ウインドウ',
  'menu.help': 'ヘルプ',

  // ---- Menu — App (macOS) ------------------------------------------------
  'menu.app.about': '{name} について',
  'menu.app.services': 'サービス',
  'menu.app.hide': '{name} を隠す',
  'menu.app.hideOthers': 'ほかを隠す',
  'menu.app.showAll': 'すべてを表示',
  'menu.app.quit': '{name} を終了',
  'menu.app.settings': '設定…',

  // ---- Menu — Window (macOS) ---------------------------------------------
  'menu.window.minimize': 'しまう',
  'menu.window.zoom': '拡大/縮小',
  'menu.window.front': 'すべてを手前に移動',

  // ---- Menu — File -------------------------------------------------------
  'menu.file.openRepo': 'リポジトリを開く…',
  'menu.file.closeTab': 'タブを閉じる',
  'menu.file.settings': '設定…',
  'menu.file.quit': '終了',

  // ---- Menu — Edit -------------------------------------------------------
  'menu.edit.cut': 'カット',
  'menu.edit.copy': 'コピー',
  'menu.edit.paste': 'ペースト',
  'menu.edit.selectAll': 'すべてを選択',

  // ---- Menu — View -------------------------------------------------------
  'menu.view.branches': 'ブランチ',
  'menu.view.status': 'ステータス',
  'menu.view.log': 'ログ',
  'menu.view.refresh': '更新',
  'menu.view.toggleTheme': 'テーマを切替',
  'menu.view.toggleDevTools': '開発者ツールを切替',

  // ---- Menu — Window (gbl-specific) --------------------------------------
  'menu.window.nextRepo': '次のリポジトリ',
  'menu.window.prevRepo': '前のリポジトリ',

  // ---- Menu — Help -------------------------------------------------------
  'menu.help.shortcuts': 'キーボードショートカット',

  // ---- Topbar ------------------------------------------------------------
  'topbar.open': '開く',
  'topbar.help': 'キーボードショートカット (?)',
  'topbar.settings': '設定 (⌘,)',

  // ---- Repository tabs ---------------------------------------------------
  'repoTabs.repos': 'リポジトリ',
  'repoTabs.empty.before': '上部タブバーの ',
  'repoTabs.empty.openLabel': '開く',
  'repoTabs.empty.after': ' から git リポジトリを追加してください。',
  'repoTabs.close': '閉じる',
  'repoTabs.dragToReorder': 'ドラッグで並べ替え',
  'repoTabs.missingTitle': '{n} 件のリポジトリを再オープンできませんでした',
  'repoTabs.missingDismiss': '閉じる',

  // ---- Empty state -------------------------------------------------------
  'empty.title': 'リポジトリが開かれていません',
  'empty.body.before': '上部タブバーの ',
  'empty.body.openLabel': '開く',
  'empty.body.middle':
    ' から git リポジトリを追加できます。複数のリポジトリを開いて、上部タブバーで切り替えられます。 ',
  'empty.body.after': ' でショートカットを表示します。',

  // ---- Drag and drop -----------------------------------------------------
  'drop.title': 'ドロップしてリポジトリを開く',
  'drop.body': 'Git リポジトリフォルダを Goblin のどこにでもドロップできます。',
  'drop.openFailed': 'リポジトリを開けませんでした',

  // ---- Right-side tabs ---------------------------------------------------
  'tab.branches': 'ブランチ',
  'tab.status': 'ステータス',
  'tab.log': 'ログ',
  'tab.fetching': 'fetch 中',
  'tab.fetchingTitle': 'バックグラウンドの fetch 実行中',
  'tab.fetchFailed': 'fetch 失敗',
  'tab.fetchFailedTitle': '直近のバックグラウンド fetch が失敗しました — ネットワークやリモートを確認してください。',

  // ---- Branches list -----------------------------------------------------
  'branches.empty': 'このリポジトリにブランチがありません。',
  'branches.gone': '消失',
  'branches.dirty': '変更あり',
  'branches.worktree': 'wt',
  'branches.noUpstream': '上流なし',

  // ---- Log list ----------------------------------------------------------
  'log.showingBranch': 'コミット',
  'log.empty': '表示できるコミットがありません。',
  'log.emptyForBranch': '{branch} に表示できるコミットがありません。',

  // ---- Status ------------------------------------------------------------
  'status.cleanTitle': '作業ツリーはクリーンです',
  'status.cleanBody': 'コミットすべき変更はありません。',
  'status.mainWorktree': 'メイン',
  'status.worktreeClean': 'クリーン',
  'status.staged': 'ステージ済み',
  'status.stagedHint': 'コミット可能',
  'status.unstaged': '未ステージ',
  'status.unstagedHint': '作業ツリーで変更',
  'status.untracked': '未追跡',
  'status.untrackedHint': '未追加',
  'status.label.untracked': '未追跡',
  'status.label.ignored': '無視',
  'status.label.added': '追加',
  'status.label.deleted': '削除',
  'status.label.modified': '変更',
  'status.label.renamed': 'リネーム',
  'status.label.copied': 'コピー',
  'status.label.conflict': '競合',
  'status.label.changed': '変更',
  'status.copyPatch': 'パッチをコピー',
  'status.copyPatchTitle': 'このワークツリーの git apply --binary 用パッチをクリップボードにコピー',
  'status.copyPatchOk': 'パッチをクリップボードにコピーしました',
  'status.copyPatchEmpty': 'コピー対象なし — ワークツリーはクリーンです',

  // ---- Worktree row actions (used by branch rows that have a worktree) --
  'worktrees.revealTitle': 'Finder で表示',
  'worktrees.openInGhosttyTitle': 'Ghostty で開く',
  'worktrees.openInGhosttyLabel': 'Ghostty',

  // ---- Repo actions ------------------------------------------------------
  'action.checkout': 'チェックアウト',
  'action.pull': 'プル',
  'action.push': 'プッシュ',
  'action.fetch': 'フェッチ',
  'action.github': 'GitHub',
  'action.deleteBranch': 'ブランチを削除',
  'action.removeWorktree': 'ワークツリーを削除',
  'action.checkoutCurrent': 'すでにこのブランチです',
  'action.checkoutInWorktree': '{path} のワークツリーですでにチェックアウト済み',
  'action.checkoutTitle': '{branch} をチェックアウト',
  'action.pullFrom': '{tracking} から取得',
  'action.pullNoUpstream': '上流なし',
  'action.pushTitle': '{branch} を origin にプッシュ',
  'action.fetchTitle': 'git fetch --all --prune',
  'action.githubTitle': 'リポジトリをブラウザで開く',
  'action.resultOk': 'OK',
  'action.resultError': 'エラー',
  'action.confirmPushProtectedTitle': '{branch} にプッシュしますか？',
  'action.confirmPushProtectedBody.before': 'このまま ',
  'action.confirmPushProtectedBody.after':
    ' に直接プッシュしようとしています。通常はプルリクエスト経由が望ましいですが、続行しますか？',
  'action.confirmPushConfirm': 'プッシュを続行',
  'action.confirmDeleteBranchTitle': '{branch} を削除しますか？',
  'action.confirmDeleteBranchBody.before': 'ローカルブランチ ',
  'action.confirmDeleteBranchBody.after': ' を削除します。完全にマージされていない場合、Git が拒否します。',
  'action.confirmDeleteBranchConfirm': 'ブランチを削除',
  'action.confirmRemoveWorktreeTitle': '{branch} のワークツリーを削除しますか？',
  'action.confirmRemoveWorktreeBody.before': 'ワークツリーのディレクトリ ',
  'action.confirmRemoveWorktreeBody.after': ' を削除します。',
  'action.confirmRemoveWorktreeConfirm': 'ワークツリーを削除',
  'action.confirmRemoveWorktreeAlsoDeleteBranch': 'ブランチ {branch} も削除する',
  'action.confirmRemoveWorktreeProtectedHint': 'このブランチは保護されているため、ここから削除できません。',
  'action.createWorktree': '新しいワークツリー',
  'action.createWorktreeTitle': '新しいワークツリーを作成',
  'action.createWorktreeHint': '選択したブランチから新しいブランチを作成します。',
  'action.createWorktreeBaseLabel': '元のブランチ',
  'action.createWorktreeBasePlaceholder': 'ブランチを選択',
  'action.createWorktreeBranchLabel': '新しいブランチ名',
  'action.createWorktreeBranchPlaceholder': 'feat/feature-name',
  'action.createWorktreePathLabel': 'ワークツリーのパス (任意)',
  'action.createWorktreePathDisabledHint': 'ブランチ名を入力するとパスが自動入力されます。',
  'action.createWorktreeBaseCurrent': '現在',
  'action.createWorktreeConfirm': 'ワークツリーを作成',
  'action.menu': '操作',
  'action.refresh': '更新',
  'action.refreshTitle': 'git branch · git status · git log',

  // ---- Errors / banners --------------------------------------------------
  'error.notGitRepo': 'git リポジトリではありません',
  'error.failedReadRepo': 'リポジトリの読み込みに失敗しました',
  'error.openGithubNoOrigin': 'origin リモートがありません',
  'error.invalidPath': '無効なパス',
  'error.invalidWorktreePath': '無効なワークツリーパス',
  'error.invalidArguments': '無効な引数',
  'error.networkOpInProgress': '別の git ネットワーク操作がすでに実行中です。',
  'error.unknown': '不明なエラー',
  'error.cannotDeleteCurrentBranch': '現在のブランチは削除できません',
  'error.cannotDeleteProtectedBranch': '保護されたブランチは削除できません',
  'error.cannotDeleteCheckedOutBranch': 'ワークツリーでチェックアウト済みのブランチは削除できません',
  'error.worktreeNotFoundForBranch': 'このブランチのワークツリーが見つかりません',
  'error.cannotRemoveMainWorktree': 'メインのワークツリーは削除できません',
  'error.cannotRemoveDirtyWorktree': 'ワークツリーに未コミットの変更があります — 先にコミットまたは破棄してください',
  'error.cannotRemoveLockedWorktree': 'ワークツリーがロックされています — 先にロックを解除してください',
  'error.cannotRemoveUnpushedWorktree':
    'ブランチに未プッシュのコミットがあります — 先にプッシュするか、「ブランチも削除する」のチェックを外してください',
  'error.ghosttyNotInstalled': 'Ghostty がインストールされていません',
  'error.renderCrashTitle': 'このビューの描画中にエラーが発生しました',
  'error.renderCrashUnknown': '不明な描画エラー。',
  'error.tryAgain': '再試行',
  'error.back': '戻る (Esc)',
  'error.settingsWriteTitle': '設定の保存に失敗しました',

  // ---- Settings panel ----------------------------------------------------
  'settings.title': '設定',
  'settings.appearance': '外観',
  'settings.theme.auto': '自動',
  'settings.theme.light': 'ライト',
  'settings.theme.dark': 'ダーク',
  'settings.lang': '言語',
  'settings.lang.auto': '自動',
  'settings.lang.en': 'English',
  'settings.lang.zh': '中文',
  'settings.lang.ko': '한국어',
  'settings.lang.ja': '日本語',
  'settings.fetch': '自動 fetch',
  'settings.fetchHint':
    'アクティブなリポジトリのバックグラウンド `git fetch`。低速なネットワークでは無効化してください。',
  'settings.fetch.off': 'オフ',
  'settings.fetch.30s': '30 秒',
  'settings.fetch.1m': '1 分',
  'settings.fetch.5m': '5 分',
  'settings.fetch.15m': '15 分',

  // ---- Help overlay ------------------------------------------------------
  'help.title': 'キーボードショートカット',
  'help.section.nav': 'ナビゲーション',
  'help.section.views': 'ビュー',
  'help.section.actions': 'アクション',
  'help.row.nextBranch': '次のブランチ / コミット',
  'help.row.prevBranch': '前のブランチ / コミット',
  'help.row.nextRepo': '次のリポジトリ',
  'help.row.prevRepo': '前のリポジトリ',
  'help.row.viewBranches': 'ブランチ',
  'help.row.viewStatus': 'ステータス',
  'help.row.viewLog': 'ログ',
  'help.row.checkout': 'ブランチを切替 / コミットを開く',
  'help.row.openRepo': 'リポジトリを開く',
  'help.row.activateWindow': 'Goblin ウィンドウを表示',
  'help.row.closeRepo': '現在のタブを閉じる',
  'help.row.refresh': '更新',
  'help.row.settings': '設定',
  'help.row.thisHelp': 'このヘルプ',
  'help.row.dismiss': 'オーバーレイを閉じる',

  // ---- Generic dialog ----------------------------------------------------
  'dialog.cancel': 'キャンセル',
  'dialog.close': '閉じる (Esc)',

  // ---- Commit detail -----------------------------------------------------
  'commit.parent': '親コミット',
  'commit.parents': '親コミット',
  'commit.filesChanged': '{n} 件のファイル変更',
  'commit.filesChangedPlural': '{n} 件のファイル変更',
  'commit.empty': 'ファイル変更なし（マージまたは空コミット）。',
  'commit.binary': 'バイナリ',
}
