import React, { useEffect, useState, useCallback, useRef } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import "./ImageList.css";

interface VaultMedia {
  name: string;
  path: string;
  media_type: string; // "image" | "video"
}

interface VaultFolder {
  name: string;
  path: string;
  count: number;
}

interface VaultConfigInfo {
  is_configured: boolean;
  current_path: string;
  default_path: string;
}

type ActiveFolderTab = "__all__" | null | string;

const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;
const VIDEO_EXTS = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;

export default function ImageList() {
  const [media, setMedia] = useState<VaultMedia[]>([]);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [rootCount, setRootCount] = useState(0);
  const [activeTab, setActiveTab] = useState<ActiveFolderTab>("__all__");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<VaultMedia | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Configuration & Onboarding
  const [vaultConfig, setVaultConfig] = useState<VaultConfigInfo | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedCustomPath, setSelectedCustomPath] = useState<string>("");

  const isInternalDragRef = useRef(false);
  const draggedMediaRef = useRef<VaultMedia | null>(null);
  const dragCounterRef = useRef(0);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  };

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await invoke<VaultConfigInfo>("get_vault_config");
      setVaultConfig(cfg);
      setSelectedCustomPath(cfg.current_path);
      if (!cfg.is_configured) {
        setShowConfigModal(true);
      }
    } catch (err) {
      console.error("Erreur chargement config :", err);
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const list = await invoke<VaultFolder[]>("get_vault_folders");
      setFolders(list);
      const total = await invoke<number>("get_total_media_count");
      setTotalCount(total);
      const root = await invoke<number>("get_root_media_count");
      setRootCount(root);
    } catch (err) {
      console.error("Erreur chargement dossiers :", err);
    }
  }, []);

  const loadMedia = useCallback(async () => {
    try {
      const list = await invoke<VaultMedia[]>("get_vault_images", {
        folder: activeTab === "__all__" ? "__all__" : activeTab,
      });
      setMedia((prev) => {
        if (
          prev.length === list.length &&
          prev.every((m, i) => m.path === list[i]?.path && m.name === list[i]?.name)
        ) {
          return prev;
        }
        return list;
      });
    } catch (err) {
      console.error("Erreur chargement médias :", err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadMedia(), loadFolders()]);
  }, [loadMedia, loadFolders]);

  // Initial config load
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Browse folder using native Windows dialog
  const handleBrowseFolder = async () => {
    try {
      const chosen = await invoke<string | null>("select_folder_dialog");
      if (chosen) {
        setSelectedCustomPath(chosen);
      }
    } catch (err) {
      console.error("Erreur sélection dossier :", err);
    }
  };

  // Save chosen storage path
  const handleSaveVaultPath = async (pathToSave?: string) => {
    const finalPath = pathToSave || selectedCustomPath;
    if (!finalPath) return;
    try {
      await invoke("set_vault_path", { path: finalPath });
      setShowConfigModal(false);
      showToast("Dossier de stockage configuré !");
      await loadConfig();
      await loadAll();
    } catch (err: unknown) {
      showToast(typeof err === "string" ? err : "Erreur enregistrement dossier");
    }
  };

  // Handle external files dropped
  const handleDroppedData = useCallback(
    async (dataTransfer: DataTransfer, targetFolder: ActiveFolderTab) => {
      const saveFolder = targetFolder === "__all__" ? null : targetFolder;

      if (dataTransfer.files && dataTransfer.files.length > 0) {
        let savedCount = 0;
        let movedCount = 0;

        for (const file of Array.from(dataTransfer.files)) {
          const filePath = (file as unknown as { path?: string }).path;

          if (filePath && filePath.includes("stocacageVault")) {
            try {
              await invoke("move_media_to_folder", {
                path: filePath,
                folder: saveFolder || "",
              });
              movedCount++;
            } catch (err) {
              console.error("Erreur déplacement:", err);
            }
            continue;
          }

          const isMedia =
            file.type.startsWith("image/") ||
            file.type.startsWith("video/") ||
            IMAGE_EXTS.test(file.name) ||
            VIDEO_EXTS.test(file.name);

          if (isMedia) {
            try {
              const buffer = await file.arrayBuffer();
              const bytes = Array.from(new Uint8Array(buffer));
              await invoke("save_image_bytes", {
                name: file.name,
                bytes,
                folder: saveFolder,
              });
              savedCount++;
            } catch (err) {
              console.error("Erreur sauvegarde fichier :", err);
            }
          }
        }

        if (movedCount > 0) {
          showToast(saveFolder ? `Déplacé dans "${saveFolder}"` : "Déplacé dans Accueil");
          await loadAll();
          return;
        }

        if (savedCount > 0) {
          showToast(`${savedCount} fichier(s) ajouté(s) !`);
          await loadAll();
          return;
        }
      }

      if (dataTransfer.items && dataTransfer.items.length > 0) {
        let savedCount = 0;
        for (const item of Array.from(dataTransfer.items)) {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (
              file &&
              (file.type.startsWith("image/") ||
                file.type.startsWith("video/") ||
                IMAGE_EXTS.test(file.name) ||
                VIDEO_EXTS.test(file.name))
            ) {
              try {
                const buffer = await file.arrayBuffer();
                const bytes = Array.from(new Uint8Array(buffer));
                await invoke("save_image_bytes", {
                  name: file.name || `media_${Date.now()}.png`,
                  bytes,
                  folder: saveFolder,
                });
                savedCount++;
              } catch (err) {
                console.error(err);
              }
            }
          }
        }
        if (savedCount > 0) {
          showToast(`${savedCount} fichier(s) ajouté(s) !`);
          await loadAll();
          return;
        }
      }

      let foundUrl = "";
      const htmlData = dataTransfer.getData("text/html");
      if (htmlData) {
        const match = htmlData.match(/<(?:img|video)[^>]+src=["']([^"']+)["']/i);
        if (match && match[1]) foundUrl = match[1];
      }

      if (!foundUrl) {
        const uriList = dataTransfer.getData("text/uri-list");
        if (uriList) {
          const lines = uriList
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#"));
          if (lines.length > 0) foundUrl = lines[0];
        }
      }

      if (!foundUrl) {
        const plain = dataTransfer.getData("text/plain");
        if (
          plain &&
          (plain.startsWith("http://") ||
            plain.startsWith("https://") ||
            plain.startsWith("data:image/") ||
            plain.startsWith("data:video/"))
        ) {
          foundUrl = plain.trim();
        }
      }

      if (foundUrl) {
        if (foundUrl.includes("asset.localhost") || foundUrl.includes("stocacageVault")) {
          return;
        }
        if (foundUrl.startsWith("data:image/") || foundUrl.startsWith("data:video/")) {
          try {
            const [header, b64] = foundUrl.split(",");
            const mime = header.match(/data:([a-zA-Z0-9+.-]+\/[a-zA-Z0-9+.-]+);/)?.[1] || "image/png";
            const ext = mime.split("/")[1].replace("jpeg", "jpg").replace("+xml", "");
            const byteChars = atob(b64);
            const bytes = new Uint8Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
              bytes[i] = byteChars.charCodeAt(i);
            }
            await invoke("save_image_bytes", {
              name: `media_${Date.now()}.${ext}`,
              bytes: Array.from(bytes),
              folder: saveFolder,
            });
            showToast("Média enregistré !");
            await loadAll();
          } catch (err) {
            console.error("Erreur base64 :", err);
          }
        } else if (foundUrl.startsWith("http://") || foundUrl.startsWith("https://")) {
          try {
            showToast("Téléchargement...");
            await invoke("download_and_save_image", { url: foundUrl, folder: saveFolder });
            showToast("Média enregistré !");
            await loadAll();
          } catch (err) {
            console.error("Erreur téléchargement :", err);
            showToast("Échec du téléchargement");
          }
        }
      }
    },
    [loadAll]
  );

  useEffect(() => {
    setLoading(true);
    loadAll();
  }, [activeTab]);

  useEffect(() => {
    loadAll();

    const pollInterval = setInterval(() => {
      loadAll();
    }, 1500);

    const handleFocus = () => loadAll();
    window.addEventListener("focus", handleFocus);

    const handleWindowDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (
        isInternalDragRef.current ||
        draggedMediaRef.current ||
        e.dataTransfer?.types.includes("application/x-stocacage-item-path")
      ) {
        return;
      }
      dragCounterRef.current += 1;
      setIsDraggingOver(true);
    };

    const handleWindowDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (
        isInternalDragRef.current ||
        draggedMediaRef.current ||
        e.dataTransfer?.types.includes("application/x-stocacage-item-path")
      ) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        setIsDraggingOver(false);
        return;
      }
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setIsDraggingOver(true);
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
      }
    };

    const handleWindowDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      if (
        (e.target as HTMLElement)?.closest(".sidebar-item") ||
        (e.target as HTMLElement)?.closest(".vault-sidebar")
      ) {
        return;
      }

      if (
        isInternalDragRef.current ||
        draggedMediaRef.current ||
        e.dataTransfer?.types.includes("application/x-stocacage-item-path")
      ) {
        isInternalDragRef.current = false;
        draggedMediaRef.current = null;
        return;
      }

      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const hasVaultFiles = Array.from(e.dataTransfer.files).some((file) => {
          const p = (file as unknown as { path?: string }).path;
          return p && p.includes("stocacageVault");
        });
        if (hasVaultFiles) {
          return;
        }
      }

      if (!e.dataTransfer) return;
      await handleDroppedData(e.dataTransfer, activeTab);
    };

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/") || item.type.startsWith("video/")) {
          const file = item.getAsFile();
          if (file) {
            const buffer = await file.arrayBuffer();
            const bytes = Array.from(new Uint8Array(buffer));
            const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
            const target = activeTab === "__all__" ? null : activeTab;
            await invoke("save_image_bytes", {
              name: `paste_${Date.now()}.${ext}`,
              bytes,
              folder: target,
            });
            showToast("Collé !");
            await loadAll();
            return;
          }
        } else if (item.type === "text/plain") {
          item.getAsString((text) => {
            const trimmed = text.trim();
            if (
              trimmed &&
              (trimmed.startsWith("http://") ||
                trimmed.startsWith("https://") ||
                trimmed.startsWith("data:image/") ||
                trimmed.startsWith("data:video/"))
            ) {
              handleDroppedData(e.clipboardData!, activeTab);
            }
          });
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreviewMedia(null);
        if (vaultConfig?.is_configured) {
          setShowConfigModal(false);
        }
      }
    };

    window.addEventListener("dragenter", handleWindowDragEnter);
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("dragleave", handleWindowDragLeave);
    window.addEventListener("drop", handleWindowDrop);
    window.addEventListener("paste", handlePaste);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("dragenter", handleWindowDragEnter);
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("dragleave", handleWindowDragLeave);
      window.removeEventListener("drop", handleWindowDrop);
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [loadAll, handleDroppedData, activeTab, vaultConfig]);

  useEffect(() => {
    if (showNewFolderInput && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [showNewFolderInput]);

  useEffect(() => {
    if (renamingFolder && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingFolder]);

  // Drag start on a card: e.preventDefault() is required for native OLE drag into Discord/Slack/Explorer
  const handleDragStart = async (e: React.DragEvent, item: VaultMedia) => {
    isInternalDragRef.current = true;
    draggedMediaRef.current = item;

    if (e.dataTransfer) {
      e.dataTransfer.setData("application/x-stocacage-item-path", item.path);
      e.dataTransfer.setData("text/plain", item.path);
      e.dataTransfer.effectAllowed = "copyMove";
    }

    e.preventDefault();

    try {
      await startDrag({
        item: [item.path],
        icon: item.media_type === "video" ? "" : item.path,
      });
    } catch (err) {
      console.error("startDrag error:", err);
    } finally {
      setTimeout(() => {
        isInternalDragRef.current = false;
        draggedMediaRef.current = null;
      }, 250);
    }
  };

  const handleDragEnd = () => {
    isInternalDragRef.current = false;
    draggedMediaRef.current = null;
    setDragOverFolder(null);
  };

  // Dropping onto a specific folder in the sidebar
  const handleFolderDrop = async (e: React.DragEvent, targetFolder: ActiveFolderTab) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);
    setIsDraggingOver(false);

    let sourcePath = draggedMediaRef.current?.path || "";

    if (!sourcePath && e.dataTransfer) {
      sourcePath = e.dataTransfer.getData("application/x-stocacage-item-path");
    }
    if (!sourcePath && e.dataTransfer) {
      const plain = e.dataTransfer.getData("text/plain");
      if (plain && plain.includes("stocacageVault")) {
        sourcePath = plain;
      }
    }
    if (!sourcePath && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const p = (e.dataTransfer.files[0] as unknown as { path?: string }).path;
      if (p && p.includes("stocacageVault")) {
        sourcePath = p;
      }
    }

    if (sourcePath) {
      const folderTarget = targetFolder === "__all__" ? "" : targetFolder || "";

      const normalizedSource = sourcePath.replace(/\\/g, "/");
      const isAlreadyInRoot = !folders.some((f) =>
        normalizedSource.includes(`/${f.name}/`)
      );
      const isAlreadyInTarget =
        folderTarget === ""
          ? isAlreadyInRoot
          : normalizedSource.includes(`/${folderTarget}/`);

      if (isAlreadyInTarget) {
        draggedMediaRef.current = null;
        isInternalDragRef.current = false;
        return;
      }

      try {
        await invoke("move_media_to_folder", {
          path: sourcePath,
          folder: folderTarget,
        });
        showToast(folderTarget ? `Déplacé dans "${folderTarget}"` : "Déplacé dans Accueil");
        await loadAll();
      } catch (err) {
        console.error("Erreur déplacement média :", err);
        showToast("Erreur lors du déplacement");
      } finally {
        draggedMediaRef.current = null;
        isInternalDragRef.current = false;
      }
      return;
    }

    if (e.dataTransfer) {
      await handleDroppedData(e.dataTransfer, targetFolder);
    }
  };

  const handleOpenFolder = async () => {
    try {
      const folderArg = activeTab === "__all__" ? null : activeTab;
      await invoke("open_vault_folder", { folder: folderArg });
    } catch (err) {
      console.error("Erreur ouverture dossier :", err);
    }
  };

  const handleDeleteMedia = async (e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    try {
      await invoke("delete_vault_image", { path });
      showToast("Supprimé");
      if (previewMedia?.path === path) setPreviewMedia(null);
      await loadAll();
    } catch (err) {
      console.error("Erreur suppression :", err);
    }
  };

  const handleCopyMedia = async (e: React.MouseEvent, item: VaultMedia) => {
    e.stopPropagation();
    if (item.media_type === "video") {
      navigator.clipboard.writeText(item.path);
      showToast("Chemin copié !");
      return;
    }
    try {
      const response = await fetch(convertFileSrc(item.path));
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
      showToast("Copié dans le presse-papier !");
    } catch {
      navigator.clipboard.writeText(item.path);
      showToast("Chemin copié !");
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) {
      setShowNewFolderInput(false);
      return;
    }
    try {
      await invoke("create_vault_folder", { name });
      setNewFolderName("");
      setShowNewFolderInput(false);
      await loadFolders();
      showToast(`Dossier "${name}" créé !`);
    } catch (err: unknown) {
      showToast(typeof err === "string" ? err : "Erreur création dossier");
    }
  };

  const handleRenameFolder = async (oldName: string) => {
    const newName = renameValue.trim();
    if (!newName || newName === oldName) {
      setRenamingFolder(null);
      return;
    }
    try {
      await invoke("rename_vault_folder", { oldName, newName });
      if (activeTab === oldName) setActiveTab(newName);
      setRenamingFolder(null);
      await loadFolders();
      showToast("Dossier renommé !");
    } catch (err: unknown) {
      showToast(typeof err === "string" ? err : "Erreur renommage");
    }
  };

  const handleDeleteFolder = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    try {
      await invoke("delete_vault_folder", { name });
      if (activeTab === name) setActiveTab("__all__");
      await loadFolders();
      showToast(`Dossier "${name}" supprimé`);
    } catch (err: unknown) {
      showToast(typeof err === "string" ? err : "Erreur suppression dossier");
    }
  };

  const getHeaderTitle = () => {
    if (activeTab === "__all__") return "Tous les médias";
    if (activeTab === null) return "Accueil";
    return activeTab;
  };

  const renderCard = (item: VaultMedia) => (
    <div
      key={item.path}
      className="discord-card"
      draggable={true}
      onDragStart={(e) => handleDragStart(e, item)}
      onDragEnd={handleDragEnd}
      onClick={(e) => handleCopyMedia(e, item)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setPreviewMedia(item);
      }}
      title={`${item.name}\n(Double-clic pour agrandir, clic pour copier)`}
    >
      <div className="card-hover-overlay">
        {item.media_type === "video" && (
          <span className="card-video-badge">VIDÉO</span>
        )}
        <button
          type="button"
          className="card-icon-btn"
          onClick={(e) => {
            e.stopPropagation();
            setPreviewMedia(item);
          }}
          title="Agrandir en plein écran"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        <button
          type="button"
          className="card-icon-btn"
          onClick={(e) => handleCopyMedia(e, item)}
          title={item.media_type === "video" ? "Copier le chemin" : "Copier l'image"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <button
          type="button"
          className="card-icon-btn delete"
          onClick={(e) => handleDeleteMedia(e, item.path)}
          title="Supprimer"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      {item.media_type === "video" ? (
        <video
          src={convertFileSrc(item.path)}
          className="discord-img"
          muted
          loop
          playsInline
          onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play()}
          onMouseLeave={(e) => {
            const v = e.currentTarget as HTMLVideoElement;
            v.pause();
            v.currentTime = 0;
          }}
          onClick={(e) => {
            e.stopPropagation();
            handleCopyMedia(e as unknown as React.MouseEvent, item);
          }}
        />
      ) : (
        <img
          src={convertFileSrc(item.path)}
          alt={item.name}
          className="discord-img"
          loading="lazy"
        />
      )}
    </div>
  );

  const col1 = media.filter((_, i) => i % 2 === 0);
  const col2 = media.filter((_, i) => i % 2 === 1);

  return (
    <div className="vault-layout">
      {/* Sidebar with folders */}
      <div className={`vault-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        {/* 1. Tous les médias */}
        <div
          className={`sidebar-item ${activeTab === "__all__" ? "active" : ""}`}
          onClick={() => setActiveTab("__all__")}
          title="Tous les médias de tous les dossiers"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          <span className="sidebar-label">Tous</span>
          <span className="sidebar-count">{totalCount}</span>
        </div>

        {/* 2. Accueil (Racine) */}
        <div
          className={`sidebar-item ${activeTab === null ? "active" : ""} ${
            dragOverFolder === "root" ? "drag-target" : ""
          }`}
          onClick={() => setActiveTab(null)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
            if (dragOverFolder !== "root") setDragOverFolder("root");
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            if (dragOverFolder === "root") setDragOverFolder(null);
          }}
          onDrop={(e) => handleFolderDrop(e, null)}
          title="Dossier racine (Accueil) - Déposez ici pour déplacer à la racine"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span className="sidebar-label">Accueil</span>
          <span className="sidebar-count">{rootCount}</span>
        </div>

        <div className="sidebar-divider" />

        {/* 3. Sub-folders list */}
        {folders.map((folder) => (
          <div key={folder.name} className="sidebar-folder-row">
            {renamingFolder === folder.name ? (
              <input
                ref={renameInputRef}
                className="sidebar-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => handleRenameFolder(folder.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameFolder(folder.name);
                  if (e.key === "Escape") setRenamingFolder(null);
                }}
              />
            ) : (
              <div
                className={`sidebar-item ${activeTab === folder.name ? "active" : ""} ${
                  dragOverFolder === folder.name ? "drag-target" : ""
                }`}
                onClick={() => setActiveTab(folder.name)}
                onDoubleClick={() => {
                  setRenamingFolder(folder.name);
                  setRenameValue(folder.name);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                  if (dragOverFolder !== folder.name) setDragOverFolder(folder.name);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  if (dragOverFolder === folder.name) setDragOverFolder(null);
                }}
                onDrop={(e) => handleFolderDrop(e, folder.name)}
                title={`${folder.name} (Double-clic pour renommer, glissez-déposez pour déplacer)`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span className="sidebar-label">{folder.name}</span>
                <span className="sidebar-count">{folder.count}</span>
              </div>
            )}
            <button
              type="button"
              className="sidebar-delete-btn"
              onClick={(e) => handleDeleteFolder(e, folder.name)}
              title="Supprimer le dossier"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}

        {/* Add new folder */}
        {showNewFolderInput ? (
          <div className="sidebar-new-folder">
            <input
              ref={newFolderInputRef}
              className="sidebar-rename-input"
              placeholder="Nom..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") {
                  setShowNewFolderInput(false);
                  setNewFolderName("");
                }
              }}
              onBlur={() => {
                if (!newFolderName.trim()) {
                  setShowNewFolderInput(false);
                } else {
                  handleCreateFolder();
                }
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="sidebar-add-btn"
            onClick={() => setShowNewFolderInput(true)}
            title="Créer un nouveau dossier"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Dossier</span>
          </button>
        )}
      </div>

      {/* Main vault area */}
      <div className="vault-container">
        {/* Top bar header */}
        <div className="vault-header">
          <div className="vault-header-left">
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? "Afficher les dossiers" : "Masquer les dossiers"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
            <span className="vault-title">{getHeaderTitle()}</span>
            <span className="vault-badge">{media.length}</span>
          </div>
          <div className="vault-actions">
            <button
              type="button"
              className="action-btn icon-only"
              onClick={() => setShowConfigModal(true)}
              title="Configurer le dossier de stockage"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={handleOpenFolder}
              title="Ouvrir dans l'Explorateur Windows"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span>Dossier</span>
            </button>
          </div>
        </div>

        {/* Media Grid */}
        {loading ? (
          <div className="empty-state">
            <p className="empty-title">Chargement...</p>
          </div>
        ) : media.length === 0 ? (
          <div className="empty-state">
            <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p className="empty-title">Aucun média</p>
            <p className="empty-subtitle">
              Glissez des images ou vidéos ici,<br />ou faites Ctrl+V !
            </p>
          </div>
        ) : (
          <div className="discord-masonry-container">
            <div className="masonry-col">
              {col1.map(renderCard)}
            </div>
            {col2.length > 0 && (
              <div className="masonry-col">
                {col2.map(renderCard)}
              </div>
            )}
          </div>
        )}

        {/* Lightbox / Fullscreen Preview Modal */}
        {previewMedia && (
          <div
            className="lightbox-overlay"
            onClick={() => setPreviewMedia(null)}
          >
            <button
              type="button"
              className="lightbox-close-btn"
              onClick={() => setPreviewMedia(null)}
              title="Fermer (Échap)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
              {previewMedia.media_type === "video" ? (
                <video
                  src={convertFileSrc(previewMedia.path)}
                  controls
                  autoPlay
                  className="lightbox-media"
                />
              ) : (
                <img
                  src={convertFileSrc(previewMedia.path)}
                  alt={previewMedia.name}
                  className="lightbox-media"
                />
              )}
              <div className="lightbox-caption">{previewMedia.name}</div>
            </div>
          </div>
        )}

        {/* Storage Configuration / Onboarding Modal */}
        {showConfigModal && (
          <div
            className="config-modal-overlay"
            onClick={() => {
              if (vaultConfig?.is_configured) setShowConfigModal(false);
            }}
          >
            <div className="config-modal" onClick={(e) => e.stopPropagation()}>
              <div className="config-header">
                <div className="config-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="config-title-group">
                  <h3 className="config-title">Dossier de stockage</h3>
                  <p className="config-subtitle">
                    Choisissez où enregistrer vos images & vidéos.
                  </p>
                </div>
              </div>

              <div className="config-path-box">
                <span className="config-path-label">Dossier sélectionné</span>
                <div className="config-path-value">
                  {selectedCustomPath || vaultConfig?.default_path}
                </div>
                <button
                  type="button"
                  className="config-browse-btn"
                  onClick={handleBrowseFolder}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>Parcourir...</span>
                </button>
              </div>

              <div className="config-actions">
                <button
                  type="button"
                  className="config-confirm-btn"
                  onClick={() => handleSaveVaultPath()}
                >
                  Valider ce dossier
                </button>
                {vaultConfig?.default_path && selectedCustomPath !== vaultConfig.default_path && (
                  <button
                    type="button"
                    className="config-cancel-btn"
                    onClick={() => handleSaveVaultPath(vaultConfig.default_path)}
                  >
                    Utiliser le dossier par défaut ({vaultConfig.default_path.split('\\').pop()})
                  </button>
                )}
                {vaultConfig?.is_configured && (
                  <button
                    type="button"
                    className="config-cancel-btn"
                    onClick={() => setShowConfigModal(false)}
                  >
                    Annuler
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Global Drop Overlay */}
        {isDraggingOver && (
          <div className="drop-overlay">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="drop-overlay-text">Déposez dans {getHeaderTitle()}</span>
            <span className="drop-overlay-subtext">Images & Vidéos acceptées</span>
          </div>
        )}

        {/* Toast */}
        {toast && <div className="toast-msg">{toast}</div>}
      </div>
    </div>
  );
}
