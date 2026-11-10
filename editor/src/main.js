import './styles/fonts.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/editor.css';
import './styles/timeline.css';
import './styles/home.css';
import './styles/responsive.css';
import { h } from './lib/dom.js';
import { icon, appIcon } from './lib/icons.js';
import { applyTheme } from './ui/prefs.js';
import { Library } from './storage/library.js';
import { puterBackend, opfsBackend, opfsAvailable, memoryBackend } from './storage/backends.js';
import { Home } from './ui/home.js';
import { importProjectBundle } from './storage/bundle.js';
import { toast, confirmDialog } from './ui/dialog.js';
import { loadDsp } from './media/dsp.js';
import { parseReviewHash } from './review/protocol.js';
import { confirmLeave, finishUploads } from './ui/leave.js';

const root = document.getElementById('app');
applyTheme();
loadDsp();

let library = null;
let account = null;
let view = null;
// Set once the user chose to leave the page (signing out, closing the window): no more questions.
let leaving = false;

function loading(text) {
  root.setAttribute('aria-busy', 'true');
  root.replaceChildren(h('div.splash', { role: 'status' }, appIcon(56), h('div.spinner'), h('p', text)));
}

function errorScreen(title, message, retry) {
  root.removeAttribute('aria-busy');
  root.replaceChildren(h('main#main.splash', icon('cloudOff', 32), h('h1.splash-title', title), h('p.splash-sub', message), retry ? h('button.btn.primary', { type: 'button', onclick: retry }, 'Try again') : null));
}

function showHome() {
  view?.dispose?.();
  if (/#(project|review)=/.test(location.hash)) history.replaceState(null, '', `${location.pathname}${location.search}`);
  view = new Home(root, {
    library,
    account,
    onOpen: (id) => openProject(id),
    onCreate: (opts) => createProject(opts),
    onImportFiles: (files) => createProject({ ratio: 'original' }, files),
  });
}

async function openProject(id, files) {
  view?.dispose?.();
  loading('Opening project...');
  let project;
  try {
    project = await library.openProject(id);
  } catch (err) {
    toast(err?.message || "Couldn't open the project.", { kind: 'error' });
    showHome();
    return;
  }
  if (project.deletedAt) {
    toast(`${project.name} is in the Trash. Restore it to open it.`, { kind: 'error' });
    history.replaceState(null, '', '#trash');
    showHome();
    return;
  }
  // Open in another tab too: edits in both would overwrite each other, so ask first.
  const claim = await library.claimProject(id);
  if (!claim.held) {
    const ok = await confirmDialog({
      title: 'Project open in another tab',
      message: `${project.name} is already open in another tab or window. Changes made in both places overwrite each other. Open it here anyway?`,
      confirm: 'Open anyway',
      cancel: 'Go back',
    });
    if (!ok) {
      claim.release();
      showHome();
      return;
    }
  }
  const { Editor } = await import('./ui/editor.js');
  view = new Editor(root, {
    library,
    project,
    claim,
    account,
    onExit: () => showHome(),
    onNewProject: () => createProject({ ratio: 'original' }),
    onOpenProject: (other) => openProject(other),
  });
  history.replaceState(null, '', `#project=${encodeURIComponent(id)}`);
  if (files?.length) {
    const assets = await view.ctx.actions.importFiles(files);
    let first = true;
    for (const a of assets) {
      view.ctx.actions.addAsset(a, { start: view.ctx.store.duration, adoptRatio: first });
      first = false;
    }
    view.ctx.store.seek(0);
  }
}

async function createProject(opts = {}, files) {
  loading('Creating project...');
  try {
    const project = await library.createProject({ name: await library.nextProjectName(), ratio: opts.ratio || 'original' });
    await openProject(project.id, files);
  } catch (err) {
    console.error(err);
    toast("Couldn't create a project.", { kind: 'error' });
    showHome();
  }
}

async function openBundle(file) {
  loading('Opening project file...');
  try {
    const { project } = await importProjectBundle(library, file);
    await openProject(project.id);
  } catch (err) {
    console.error(err);
    toast(err?.message || "Couldn't open the project file.", { kind: 'error' });
    showHome();
  }
}

async function profilePicture() {
  try {
    return await puter.auth.getProfilePicture();
  } catch {
    return null;
  }
}

async function startSignedIn(env) {
  loading('Loading your projects...');
  let user = null;
  try {
    user = await puter.auth.getUser();
  } catch {
    /* the avatar falls back to an icon */
  }
  library = new Library(puterBackend(puter));
  account = {
    user,
    env,
    picture: await profilePicture(),
    onSignOut: env === 'app' ? null : async () => {
      if (!(await leavePage())) return;
      await puter.auth.signOut();
      location.hash = '';
      location.reload();
    },
  };
  watchWindowClose();
  route();
}

/** Inside the Puter desktop: save (or ask) before the window closes, from any screen. */
function watchWindowClose() {
  if (typeof puter === 'undefined' || puter.env !== 'app' || !puter.ui?.onWindowClose) return;
  puter.ui.onWindowClose(async () => {
    if (await leavePage()) puter.exit();
  });
}

/**
 * The page is about to go away: save the open project and wait for media
 * uploads, asking first when something couldn't be stored. Resolves false
 * to stay.
 */
async function leavePage() {
  if (leaving) return true;
  if (view?.prepareToLeave) {
    if (!(await view.prepareToLeave({ waitForUploads: true }))) return false;
  } else {
    const media = await finishUploads(library);
    if (media && !(await confirmLeave(library, { media }))) return false;
  }
  leaving = true;
  if (view) view.pageLeaving = true;
  return true;
}

function startLocal(env) {
  library = new Library(opfsAvailable() ? opfsBackend() : memoryBackend());
  account = {
    user: null,
    env,
    picture: null,
    onSignIn: typeof puter !== 'undefined' ? async () => {
      try {
        await puter.auth.signIn();
        location.reload();
      } catch {
        /* closed */
      }
    } : null,
  };
  watchWindowClose();
  route();
}

/** A review link (#review=...): the focused review screen, for reviewers and the owner alike. */
async function openReview(link) {
  // A review link pasted over the editor: save first, and stay if the user wants to after a failed save.
  if (view?.prepareToLeave) {
    if (!(await view.prepareToLeave())) {
      history.replaceState(null, '', `#project=${encodeURIComponent(view.store.project.id)}`);
      return;
    }
    await view.saveCover?.();
  }
  view?.dispose?.();
  loading('Opening review...');
  const { ReviewPage } = await import('./ui/review/review-page.js');
  view = new ReviewPage(root, {
    puter: typeof puter !== 'undefined' ? puter : null,
    account,
    link,
    onHome: () => showHome(),
    // Signing in changes which library and account the app uses, so start over.
    onSignedIn: () => location.reload(),
  });
}

async function route() {
  let review = null;
  try {
    review = parseReviewHash(location.hash);
  } catch (err) {
    errorScreen('This review link does not work', err.message, null);
    return;
  }
  const m = /#project=([^&]+)/.exec(location.hash);
  if (review) {
    openReview(review);
    return;
  }
  if (m) {
    await openProject(decodeURIComponent(m[1]));
    return;
  }

  // Auto-open project ("Già come progetto aperto")
  try {
    const list = await library.listProjects();
    if (list && list.length > 0) {
      await openProject(list[0].id);
      return;
    }
  } catch (err) {
    console.warn('Could not list projects, creating default:', err);
  }
  await createProject({ ratio: '16:9' });
}

async function boot() {
  // Offline-first local storage (OPFS / IndexedDB / Memory)
  startLocal('web');
}

// Media still uploading (or waiting to be tried again) after leaving the editor: warn before the page closes.
window.addEventListener('beforeunload', (e) => {
  if (leaving || !library?.unsavedMedia) return;
  e.preventDefault();
  e.returnValue = '';
});

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
});

// Integration API for Wox Cinema Studio Pro
window.vs = {
  get view() {
    return view;
  },
  get ctx() {
    return view?.ctx;
  },
  async importMediaFiles(files, { addToTimeline = true } = {}) {
    if (!view?.ctx) {
      try {
        const list = await library.listProjects();
        if (list && list.length) await openProject(list[0].id);
        else await createProject({ ratio: '16:9' });
      } catch (e) {
        console.warn('[VideoStudio] Project open/create fallback:', e);
        await createProject({ ratio: '16:9' });
      }
    }
    for (let i = 0; i < 50 && !view?.ctx; i++) await new Promise((r) => setTimeout(r, 100));
    if (!view?.ctx?.actions?.importFiles) {
      throw new Error('Video Studio editor not initialized');
    }

    // Convert any cross-realm files/blobs into this window's File objects
    const safeFiles = [];
    for (const f of files) {
      if (f instanceof File) {
        safeFiles.push(f);
      } else {
        const buf = await f.arrayBuffer();
        const lf = new File([buf], f.name || 'media.mp4', { type: f.type || 'video/mp4' });
        safeFiles.push(lf);
      }
    }

    const assets = await view.ctx.actions.importFiles(safeFiles, { addToTimeline: false });
    if (!assets || !assets.length) {
      throw new Error('Import failed to produce assets');
    }

    if (addToTimeline) {
      for (const a of assets) {
        view.ctx.actions.addAsset(a, { start: view.ctx.store.duration });
      }
      view.ctx.store.seek(0);
    }

    return assets;
  },
};

window.addEventListener('message', async (event) => {
  if (event.data?.type === 'WOX_IMPORT_MEDIA') {
    const { url, name, mime, addToTimeline = true } = event.data;
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const file = new File([blob], name || 'wox_media.mp4', { type: mime || blob.type || 'video/mp4' });
      const assets = await window.vs.importMediaFiles([file], { addToTimeline });
      window.parent?.postMessage({ type: 'WOX_IMPORT_SUCCESS', name: file.name, count: assets.length }, '*');
    } catch (err) {
      console.error('[VideoStudio] Import error:', err);
      window.parent?.postMessage({ type: 'WOX_IMPORT_ERROR', error: String(err) }, '*');
    }
  }
});

if (typeof window !== 'undefined' && !window.__VIDEO_STUDIO_TEST__) boot();

