export default function Header(handleMinimize: () => Promise<void>) {
    return(
        <header className="titlebar" data-tauri-drag-region>
            <div className="titlebar-drag-region" data-tauri-drag-region />
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
    )
}