export function AccentToggle({ label, checked, onChange, compact = false }) {
  const wrapperClasses = compact
    ? "rounded-lg px-2 py-1.5"
    : "rounded-xl px-2.5 py-2";
  const labelClasses = compact ? "text-[9px]" : "text-[11px]";
  const metaClasses = compact ? "text-[7px]" : "text-[8px]";
  const switchClasses = compact ? "h-5 w-10" : "h-6 w-11";
  const knobClasses = compact ? "h-4 w-4" : "h-5 w-5";
  const knobShift = compact ? "translate-x-5" : "translate-x-5";

  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-3 border transition ${wrapperClasses} ${
        checked
          ? "border-[#ef4444]/55 bg-[linear-gradient(135deg,rgba(127,29,29,0.92),rgba(69,10,10,0.82))] shadow-[0_0_18px_rgba(239,68,68,0.14)]"
          : "border-white/10 bg-slate-950/80 hover:border-white/20 hover:bg-slate-900/85"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="sr-only"
      />
      <div className="min-w-0">
        <p className={`${labelClasses} font-semibold text-white`}>{label}</p>
        <p
          className={`${metaClasses} mt-0.5 font-black uppercase tracking-[0.22em] ${
            checked ? "text-red-200/85" : "text-slate-500"
          }`}
        >
          {checked ? "Active" : "Standby"}
        </p>
      </div>
      <span
        className={`relative inline-flex shrink-0 items-center rounded-full border transition ${switchClasses} ${
          checked
            ? "border-red-200/70 bg-[linear-gradient(90deg,#991b1b,#ef4444)]"
            : "border-slate-700 bg-slate-800/95"
        }`}
      >
        <span
          className={`absolute left-0.5 top-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_12px_rgba(255,255,255,0.3)] transition-transform ${knobClasses} ${
            checked ? knobShift : "translate-x-0"
          }`}
        />
      </span>
    </label>
  );
}

export function LeverActionButton({
  label,
  busyLabel,
  onClick,
  disabled = false,
  busy = false,
  compact = false,
  type = "button",
  className = "",
}) {
  const sizeClasses = compact ? "gap-2 rounded-lg px-2 py-1.5 text-[9px]" : "gap-3 rounded-xl px-3 py-2 text-[10px]";
  const leverFrameClasses = compact ? "h-7 w-14" : "h-8 w-16";
  const leverBarClasses = compact ? "w-6" : "w-7";
  const leverHandleClasses = compact ? "h-4 w-2.5" : "h-5 w-3";
  const leverCapClasses = compact ? "h-3 w-3" : "h-3.5 w-3.5";
  const text = busy ? busyLabel || label : label;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center border border-[#ef4444]/55 bg-[linear-gradient(135deg,#b91c1c,#7f1d1d)] font-black uppercase tracking-[0.18em] text-white shadow-[0_10px_24px_rgba(127,29,29,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 ${sizeClasses} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`relative shrink-0 rounded-full border border-white/15 bg-slate-950/65 shadow-inner ${leverFrameClasses}`}
      >
        <span className="absolute left-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-slate-200/90" />
        <span
          className={`absolute left-2 top-1/2 -translate-y-1/2 rounded-full ${
            busy ? "bg-amber-200/80" : "bg-red-200/85"
          } ${leverBarClasses}`}
          style={{ height: "2px" }}
        />
        <span
          className={`absolute left-1.5 top-1/2 origin-bottom rounded-full bg-[linear-gradient(180deg,#fde68a,#f59e0b)] shadow-[0_0_12px_rgba(245,158,11,0.35)] ${
            busy ? "rotate-[10deg]" : "-rotate-[18deg]"
          } ${leverHandleClasses}`}
          style={{ transformOrigin: "bottom center" }}
        />
        <span
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full border border-red-50/80 ${
            busy ? "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.45)]" : "bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.45)]"
          } ${leverCapClasses}`}
        />
      </span>
      <span>{text}</span>
    </button>
  );
}
