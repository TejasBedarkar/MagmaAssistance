import React, { Children, cloneElement, isValidElement, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/portalActionTip.css";

function childWithoutNativeTitle(child) {
  if (!isValidElement(child)) return child;
  return cloneElement(child, { title: undefined });
}

/**
 * Hover tooltip for icon action buttons — matches portal toast styling.
 * Use in any module: wrap icon button/link with <ActionIconTip label="Edit">…</ActionIconTip>
 */
export default function ActionIconTip({ label, children }) {
  const wrapRef = useRef(null);
  const [tip, setTip] = useState(null);
  const trigger = childWithoutNativeTitle(Children.only(children));

  const showTip = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !label) return;
    const rect = el.getBoundingClientRect();
    setTip({
      left: rect.left + rect.width / 2,
      top: rect.top - 6,
    });
  }, [label]);

  const hideTip = useCallback(() => setTip(null), []);

  return (
    <>
      <span
        ref={wrapRef}
        className="portal-action-tip"
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
      >
        {trigger}
      </span>
      {tip && label
        ? createPortal(
            <span
              className="portal-action-tip__flyout"
              style={{ left: tip.left, top: tip.top }}
              role="tooltip"
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </>
  );
}
