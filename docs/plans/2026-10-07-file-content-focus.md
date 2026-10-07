# 文件在 Sidebar 内全屏

将现有面板内全屏的 `contentFocus` 从 Files tab 经 EditorHost 传到 FileViewerProps。文件路径栏、预览/编辑/保存按钮、文件树 dock、PDF 下载行、图片缩放行、Markdown 目录按钮及 HTML 沙箱状态行收起，只显示文件内容。Files 首页和目录窗口保留文件树，仅收起搜索和切换控件。恢复按钮由原面板提供。

只切换展示，不修改面板尺寸、布局推挤、持久化树展开/宽度、HTML 沙箱配置或编辑模式，不自动保存/提交草稿。路径输入、树 dock、文本编辑器、HTML iframe 和 viewer 组件保持挂载。外部 viewer 收到向后兼容的可选 `contentFocus`，可自行收起内部工具栏；第三方自有工具栏不能由宿主猜测并隐藏。

正式 Profile 的 Document Workbench 0.8.0 为 PDF 增加了「原始预览／文本选择」工具栏。它会向内置 PDF 传递完整 props，但自身未消费 `contentFocus`。通过其公开 `data-dwb-pdf` 标记限定兼容样式，在 Files 全屏时收起这行，不替换 viewer、不切换文本选择模式，不修改外部包。验收须加载准确的已安装 Workbench 包。

PDF 除收起 Sidebar 控件外，使用 `#toolbar=0&navpanes=0` 收起 Chromium 内置工具栏和缩略图导航。真实 Chrome 验证表明仅改变原 URL 的 hash 不会更新这两个控件，因此为同一已缓存 Blob 创建新 URL，让原生阅读器重新加载并应用参数。iframe、已加载字节和 Blob 保留，不重新读取文件；阅读器的滚动/缩放可能重置。替换及卸载时撤销旧 URL，正常模式重新打开原生控件。

Chromium 官方实现：[PDF Open Parameters parser](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/browser/resources/pdf/open_pdf_params_parser.ts)，`shouldShowToolbar` / `shouldShowSidenav`（2026-10-07 核对）。不改变用户 Chrome 设置。

验收使用准确安装包和隔离的真实宿主，重点核对 PDF 原生控件及 HTML5 内容、面板几何、恢复按钮、iframe 身份、未提交 HTML 输入、编辑草稿和树状态。通用面板退出/Esc/会话契约沿用现有行为。
