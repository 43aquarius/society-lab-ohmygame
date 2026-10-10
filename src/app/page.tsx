// 兜底页：正常情况下根路由被 next.config 的 beforeFiles rewrite
// 直接指向 /game/index.html（Society Lab 静态构建），此页面不会被访问；
// 仅在静态资源缺失时给出明确指引（例如构建产物未部署）。
export default function Home() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        background: "#1d2a26",
        color: "#f5efe3",
        fontFamily: "system-ui, sans-serif",
        padding: "1rem",
      }}
    >
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700 }}>人类社会实验室</h1>
      <p style={{ opacity: 0.75, fontSize: "0.95rem" }}>
        游戏资源未就绪——请先在 society-lab 工程中执行构建并把 dist/ 同步到 public/game/。
      </p>
      <a
        href="/game/index.html"
        style={{
          color: "#7fc7ad",
          border: "1px solid rgba(127,199,173,0.5)",
          borderRadius: "8px",
          padding: "8px 16px",
          textDecoration: "none",
        }}
      >
        直接进入游戏
      </a>
    </div>
  );
}
