import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./WindowFrame.css";

type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

interface WindowFrameProps {
  title?: string;
  children: React.ReactNode;
  showGrip?: boolean;
  className?: string;
}

export const WindowFrame: React.FC<WindowFrameProps> = ({
  title,
  children,
  showGrip = true,
  className = "",
}) => {
  const handleMinimize = async () => {
    try {
      await invoke("hide_window");
    } catch {
      await getCurrentWebviewWindow().hide();
    }
  };

  const handleTitlebarMouseDown = async (e: React.MouseEvent) => {
    // Only drag on primary (left) button and when not clicking the minimize button
    if (e.button === 0 && !(e.target as HTMLElement).closest(".titlebar-button")) {
      try {
        await getCurrentWebviewWindow().startDragging();
      } catch (err) {
        console.error("Start dragging error:", err);
      }
    }
  };

  const handleResize = (direction: ResizeDirection) => async (e: React.MouseEvent) => {
    if (e.button === 0) {
      e.preventDefault();
      try {
        await getCurrentWebviewWindow().startResizeDragging(direction);
      } catch (err) {
        console.error("Resize dragging error:", err);
      }
    }
  };

  return (
    <div className={`window-frame ${className}`}>
      {/* Invisible resize handles for frameless window */}
      <div className="resize-handle top" onMouseDown={handleResize("North")} />
      <div className="resize-handle bottom" onMouseDown={handleResize("South")} />
      <div className="resize-handle left" onMouseDown={handleResize("West")} />
      <div className="resize-handle right" onMouseDown={handleResize("East")} />
      <div className="resize-handle top-left" onMouseDown={handleResize("NorthWest")} />
      <div className="resize-handle bottom-left" onMouseDown={handleResize("SouthWest")} />
      <div className="resize-handle bottom-right" onMouseDown={handleResize("SouthEast")} />

      {/* Titlebar with native dragging and minimize button */}
      <header
        className="titlebar"
        data-tauri-drag-region
        onMouseDown={handleTitlebarMouseDown}
      >
        <div className="titlebar-drag-region" data-tauri-drag-region>
          {title && <span className="window-title">{title}</span>}
        </div>
        <button
          type="button"
          className="titlebar-button"
          onClick={handleMinimize}
          title="Réduire dans la zone de notification"
          aria-label="Réduire"
        >
          <span className="minimize-icon" />
        </button>
      </header>

      {/* Main app content */}
      {children}

      {/* Visual resize grip indicator in bottom-right corner */}
      {showGrip && (
        <svg
          className="resize-grip"
          viewBox="0 0 10 10"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="1" />
          <circle cx="4" cy="8" r="1" />
          <circle cx="8" cy="4" r="1" />
        </svg>
      )}
    </div>
  );
};

export default WindowFrame;
