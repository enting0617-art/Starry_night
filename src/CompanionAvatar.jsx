export default function CompanionAvatar({ state = 'idle', name = '星空', compact = false }) {
  return (
    <div className={`companion-avatar ${state} ${compact ? 'compact' : ''}`} aria-label={`${name}，${state === 'speaking' ? '正在说话' : state === 'thinking' ? '正在思考' : '在线'}`}>
      <div className="avatar-glow" />
      <img src="/assets/xingkong-avatar.png" alt="" aria-hidden="true" />
      {!compact && <div className="avatar-name"><span className="presence-dot" />{name}</div>}
    </div>
  );
}
