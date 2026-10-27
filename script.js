/* Campus Bazaar: plain JavaScript, no build step.
   1. Settings and the Firebase backend
   2. Helpers
   3. Sign-in screens
   4. Marketplace rendering
   5. Sell form
   6. Start-up                                                          */

(() => {
  'use strict';

  /* ---------------------------------------------------------------
     1. SETTINGS AND BACKENDS
     Login and listings run on Firebase. The college domain list in
     firebase-config.js decides who may sign in, and firestore.rules
     enforces the same list on the server. Without both, the site
     refuses to open.
     --------------------------------------------------------------- */

  const CONFIG = window.CAMPUS_CONFIG || {};
  const ALLOWED_DOMAINS = (CONFIG.allowedDomains || []).map((d) => String(d).toLowerCase());
  const FIREBASE_VERSION = '10.14.1';

  const PROFILE_KEY = 'campusBazaar.profile.v1';
  const MAX_PHOTOS = 3;
  const MAX_IMAGE_CHARS = 700000; // keeps one listing well under Firestore's 1 MiB limit

  const CATEGORIES = [
    { id: 'books', label: 'Books & Notes', tint: '#E3B04B' },
    { id: 'electronics', label: 'Electronics', tint: '#6D96E8' },
    { id: 'cycles', label: 'Cycles & Rides', tint: '#E27D60' },
    { id: 'hostel', label: 'Hostel Essentials', tint: '#6DBE9C' },
    { id: 'lab', label: 'Lab & Drafting Gear', tint: '#9C8FD8' },
    { id: 'furniture', label: 'Furniture', tint: '#C08A5B' },
    { id: 'clothing', label: 'Clothing', tint: '#D97FA6' },
    { id: 'other', label: 'Other', tint: '#8FA39C' }
  ];

  const CONDITIONS = ['Like new', 'Good', 'Fair', 'Needs repair'];

  const memory = {}; // fallback when localStorage is blocked

  function readJSON(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return key in memory ? memory[key] : fallback;
      return JSON.parse(raw);
    } catch (err) {
      return key in memory ? memory[key] : fallback;
    }
  }

  function writeJSON(key, value) {
    memory[key] = value;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ---------- Firebase backend (real login, shared listings) ---------- */

  async function createFirebaseBackend(firebaseConfig) {
    const base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_VERSION + '/';
    const [appSdk, authSdk, fsSdk] = await Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-auth.js'),
      import(base + 'firebase-firestore.js')
    ]);

    const app = appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    const db = fsSdk.getFirestore(app);
    const listings = fsSdk.collection(db, 'listings');

    function toUser(u) {
      const email = u.email || '';
      return {
        uid: u.uid,
        email,
        name: u.displayName || email.split('@')[0] || 'Student',
        verified: u.emailVerified === true
      };
    }

    return {
      mode: 'firebase',
      onAuth(cb) {
        authSdk.onAuthStateChanged(auth, (u) => cb(u ? toUser(u) : null));
      },
      async signInGoogle() {
        const provider = new authSdk.GoogleAuthProvider();
        if (ALLOWED_DOMAINS.length === 1) provider.setCustomParameters({ hd: ALLOWED_DOMAINS[0] });
        await authSdk.signInWithPopup(auth, provider);
      },
      async signUp(email, password) {
        const cred = await authSdk.createUserWithEmailAndPassword(auth, email, password);
        await authSdk.sendEmailVerification(cred.user);
      },
      async signIn(email, password) {
        await authSdk.signInWithEmailAndPassword(auth, email, password);
      },
      async resendVerification() {
        if (auth.currentUser) await authSdk.sendEmailVerification(auth.currentUser);
      },
      async refreshUser() {
        if (!auth.currentUser) return null;
        await auth.currentUser.reload();
        await auth.currentUser.getIdToken(true);
        return toUser(auth.currentUser);
      },
      async signOut() {
        await authSdk.signOut(auth);
      },
      subscribe(cb, onError) {
        const q = fsSdk.query(listings, fsSdk.orderBy('createdAt', 'desc'), fsSdk.limit(300));
        return fsSdk.onSnapshot(
          q,
          (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
          onError
        );
      },
      async add(item) {
        const ref = await fsSdk.addDoc(listings, item);
        return { id: ref.id, saved: true };
      },
      async setSold(id, sold) {
        await fsSdk.updateDoc(fsSdk.doc(db, 'listings', id), { sold });
      },
      async remove(id) {
        await fsSdk.deleteDoc(fsSdk.doc(db, 'listings', id));
      }
    };
  }

  let backend = null;
  let unsubscribe = null;

  const state = {
    user: null,
    listings: [],
    loaded: false,
    authMode: 'signin',
    view: 'all',
    q: '',
    cat: 'all',
    cond: 'all',
    maxPrice: '',
    sort: 'new',
    photos: []
  };

  /* ---------------------------------------------------------------
     2. HELPERS
     --------------------------------------------------------------- */

  const $ = (selector) => document.querySelector(selector);

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props) {
      Object.entries(props).forEach(([key, value]) => {
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
      });
    }
    kids.flat().forEach((kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    });
    return node;
  }

  function categoryOf(id) {
    return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
  }

  function formatPrice(price) {
    return price === 0 ? 'Free' : '₹' + Number(price).toLocaleString('en-IN');
  }

  function formatPhone(digits) {
    return '+91 ' + digits.slice(0, 5) + ' ' + digits.slice(5);
  }

  function timeAgo(timestamp) {
    const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 60) return minutes + ' min ago';
    const hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    const days = Math.round(hours / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  function escapeXml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function placeholder(categoryId) {
    const cat = categoryOf(categoryId);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">' +
      '<rect width="400" height="300" fill="' + cat.tint + '"/>' +
      '<g fill="none" stroke="rgba(255,255,255,.4)" stroke-width="2">' +
      '<circle cx="60" cy="250" r="95"/><circle cx="350" cy="35" r="75"/><circle cx="350" cy="35" r="45"/></g>' +
      '<text x="200" y="160" text-anchor="middle" font-family="sans-serif" font-size="26" font-weight="700" fill="rgba(0,0,0,.55)">' +
      escapeXml(cat.label) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  let toastTimer = null;
  function toast(message) {
    const box = $('#toast');
    box.textContent = message;
    box.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('is-visible'), 3400);
  }

  function isMine(item) {
    return Boolean(state.user) && item.sellerId === state.user.uid;
  }

  function closeIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    svg.append(path);
    return svg;
  }

  /* Photos are shrunk before saving so listings stay small and quick to load. */
  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('unreadable image'));
      img.src = src;
    });
  }

  async function compressPhoto(file) {
    const img = await loadImage(await readFile(file));
    const scale = Math.min(1, 800 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.65);
  }

  /* ---------------------------------------------------------------
     3. SIGN-IN SCREENS
     --------------------------------------------------------------- */

  function domainAllowed(email) {
    if (!ALLOWED_DOMAINS.length) return false;
    const domain = String(email).split('@')[1];
    return Boolean(domain) && ALLOWED_DOMAINS.includes(domain.toLowerCase());
  }

  function domainMessage() {
    return 'Use your college email (' + ALLOWED_DOMAINS.map((d) => '@' + d).join(' or ') + '). Other emails cannot join.';
  }

  const AUTH_MESSAGES = {
    'auth/invalid-credential': 'Email or password is wrong.',
    'auth/wrong-password': 'Email or password is wrong.',
    'auth/user-not-found': 'Email or password is wrong.',
    'auth/email-already-in-use': 'This email already has an account. Choose Sign in instead.',
    'auth/weak-password': 'Choose a password with at least 8 characters.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No internet connection. Try again.',
    'auth/popup-blocked': 'Your browser blocked the Google pop-up. Allow pop-ups and try again.',
    'auth/operation-not-allowed': 'This sign-in method is not turned on in Firebase yet.',
    'auth/unauthorized-domain': 'This website address is not allowed in Firebase. Add it under Authentication > Settings > Authorized domains.'
  };

  function authMessage(err) {
    const code = err && err.code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
    return AUTH_MESSAGES[code] || 'Something went wrong. Please try again.';
  }

  function setAuthError(message) {
    const box = $('#auth-error');
    box.textContent = message || '';
    box.hidden = !message;
  }

  function showScreen(name) {
    $('#boot').hidden = true;
    $('#screen-auth').hidden = name !== 'auth';
    $('#screen-verify').hidden = name !== 'verify';
    $('#screen-app').hidden = name !== 'app';
    const inApp = name === 'app';
    $('#search-form').hidden = !inApp;
    $('#sell-btn').hidden = !inApp;
    $('#user-chip').hidden = !inApp;
    if (!inApp) {
      closeDialog($('#sell-dialog'));
      closeDialog($('#item-dialog'));
    }
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    const signup = mode === 'signup';
    $('#mode-signin').setAttribute('aria-pressed', String(!signup));
    $('#mode-signup').setAttribute('aria-pressed', String(signup));
    $('#auth-submit').textContent = signup ? 'Create account' : 'Sign in';
    $('#a-password').setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
    $('#a-password-hint').hidden = !signup;
    setAuthError('');
  }

  function setBusy(button, busy, idleLabel) {
    button.disabled = busy;
    if (idleLabel) button.textContent = busy ? 'Please wait...' : idleLabel;
  }

  async function onAuthSubmit(event) {
    event.preventDefault();
    setAuthError('');
    const email = $('#a-email').value.trim().toLowerCase();
    const password = $('#a-password').value;
    const signup = state.authMode === 'signup';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthError('Enter a valid email address.'); return; }
    if (!domainAllowed(email)) { setAuthError(domainMessage()); return; }
    if (!password) { setAuthError('Enter your password.'); return; }
    if (signup && password.length < 8) { setAuthError('Choose a password with at least 8 characters.'); return; }

    const button = $('#auth-submit');
    const label = signup ? 'Create account' : 'Sign in';
    setBusy(button, true, label);
    try {
      if (signup) await backend.signUp(email, password);
      else await backend.signIn(email, password);
    } catch (err) {
      setAuthError(authMessage(err));
    } finally {
      setBusy(button, false, label);
    }
  }

  async function onGoogle() {
    setAuthError('');
    const button = $('#google-btn');
    setBusy(button, true);
    try {
      await backend.signInGoogle();
    } catch (err) {
      setAuthError(authMessage(err));
    } finally {
      setBusy(button, false);
    }
  }

  function showVerifyMessage(text) {
    const box = $('#verify-msg');
    box.textContent = text;
    box.hidden = !text;
  }

  async function onVerifyDone() {
    showVerifyMessage('');
    const button = $('#verify-done');
    setBusy(button, true);
    try {
      const user = await backend.refreshUser();
      if (user && user.verified) handleUser(user);
      else showVerifyMessage('Not verified yet. Open the link in your email first, then try again.');
    } catch (err) {
      showVerifyMessage(authMessage(err));
    } finally {
      setBusy(button, false);
    }
  }

  async function onVerifyResend() {
    showVerifyMessage('');
    const button = $('#verify-resend');
    setBusy(button, true);
    try {
      await backend.resendVerification();
      showVerifyMessage('Email sent again. It can take a minute to arrive.');
    } catch (err) {
      showVerifyMessage(authMessage(err));
    } finally {
      setBusy(button, false);
    }
  }

  function handleUser(user) {
    state.user = user;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    state.listings = [];
    state.loaded = false;

    if (!user) {
      showScreen('auth');
      return;
    }
    if (!domainAllowed(user.email)) {
      setAuthError(domainMessage());
      backend.signOut();
      return;
    }
    if (!user.verified) {
      $('#verify-email').textContent = user.email;
      showVerifyMessage('');
      showScreen('verify');
      return;
    }

    setAuthError('');
    $('#user-name').textContent = user.name;
    $('#user-avatar').textContent = (user.name || '?').trim().charAt(0).toUpperCase();
    showScreen('app');
    render();
    unsubscribe = backend.subscribe(onListings, onListingsError);
  }

  function onListings(items) {
    state.listings = items;
    state.loaded = true;
    render();
  }

  function onListingsError(err) {
    if (err && err.code === 'permission-denied') {
      setAuthError('This account cannot open Campus Bazaar. Sign in with your verified college email.');
      backend.signOut();
    } else {
      toast('Could not load listings. Check your internet connection.');
    }
  }

  /* ---------------------------------------------------------------
     4. MARKETPLACE RENDERING
     --------------------------------------------------------------- */

  function visibleListings() {
    const words = state.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const max = state.maxPrice === '' ? Infinity : Number(state.maxPrice);

    const list = state.listings.filter((item) => {
      if (state.view === 'mine' && !isMine(item)) return false;
      if (state.cat !== 'all' && item.category !== state.cat) return false;
      if (state.cond !== 'all' && item.condition !== state.cond) return false;
      if (item.price > max) return false;
      if (words.length) {
        const hay = [item.title, item.description, item.hostel, categoryOf(item.category).label]
          .join(' ').toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (Boolean(a.sold) !== Boolean(b.sold)) return a.sold ? 1 : -1;
      if (state.sort === 'low') return a.price - b.price;
      if (state.sort === 'high') return b.price - a.price;
      return b.createdAt - a.createdAt;
    });
    return list;
  }

  function renderCard(item) {
    const cover = item.images && item.images.length ? item.images[0] : placeholder(item.category);
    return el('article', { class: 'card' + (item.sold ? ' is-sold' : '') },
      el('div', { class: 'card__media' },
        el('img', { src: cover, alt: '', loading: 'lazy' }),
        el('span', { class: 'price', text: formatPrice(item.price) }),
        item.sold ? el('span', { class: 'badge', text: 'Sold' }) : null
      ),
      el('div', { class: 'card__body' },
        el('h3', { class: 'card__title' },
          el('button', { class: 'card__open', type: 'button', onclick: () => openItem(item.id), text: item.title })
        ),
        el('p', { class: 'card__meta', text: item.condition + (item.hostel ? ' · ' + item.hostel : '') }),
        el('p', { class: 'card__time', text: timeAgo(item.createdAt) })
      )
    );
  }

  function renderEmpty(totalInView) {
    const box = $('#empty');
    box.replaceChildren();
    if (!state.loaded) {
      box.append(el('h2', { text: 'Loading listings...' }));
    } else if (state.view === 'mine' && totalInView === 0) {
      box.append(
        el('h2', { text: 'You have not posted anything yet' }),
        el('p', { text: 'Got a book, cycle or gadget you no longer use? Post it in under a minute.' }),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: openSell, text: 'Sell an item' })
      );
    } else if (totalInView === 0) {
      box.append(
        el('h2', { text: 'No items yet' }),
        el('p', { text: 'Be the first to put something up for sale.' }),
        el('button', { class: 'btn btn--primary', type: 'button', onclick: openSell, text: 'Sell an item' })
      );
    } else {
      box.append(
        el('h2', { text: 'Nothing matches these filters' }),
        el('p', { text: 'Try a different word, or clear the filters to see everything.' }),
        el('button', { class: 'btn', type: 'button', onclick: clearFilters, text: 'Clear filters' })
      );
    }
  }

  function render() {
    if (!state.user) return;
    const items = state.loaded ? visibleListings() : [];
    const mineCount = state.listings.filter(isMine).length;
    const totalInView = state.view === 'mine' ? mineCount : state.listings.length;

    $('#grid').replaceChildren(...items.map(renderCard));
    $('#grid').hidden = items.length === 0;
    $('#empty').hidden = items.length !== 0;
    if (items.length === 0) renderEmpty(totalInView);

    $('#result-count').textContent = !state.loaded ? '' : items.length === totalInView
      ? totalInView + (totalInView === 1 ? ' item' : ' items')
      : items.length + ' of ' + totalInView + ' items';

    $('#tab-all').setAttribute('aria-pressed', String(state.view === 'all'));
    $('#tab-mine').setAttribute('aria-pressed', String(state.view === 'mine'));
    $('#tab-mine').textContent = 'My listings (' + mineCount + ')';

    document.querySelectorAll('.chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.cat === state.cat));
    });
  }

  function clearFilters() {
    state.q = '';
    state.cat = 'all';
    state.cond = 'all';
    state.maxPrice = '';
    state.sort = 'new';
    $('#q').value = '';
    $('#f-cond-filter').value = 'all';
    $('#f-max').value = '';
    $('#f-sort').value = 'new';
    render();
  }

  /* ---------- Item detail ---------- */

  function whatsappLink(item) {
    const text = 'Hi ' + item.sellerName + ', I saw your listing "' + item.title + '" (' +
      formatPrice(item.price) + ') on Campus Bazaar. Is it still available?';
    return 'https://wa.me/91' + item.contact + '?text=' + encodeURIComponent(text);
  }

  async function copyText(text, button) {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch (err) {
      const target = $('#seller-phone');
      if (target) {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      button.textContent = 'Number selected';
    }
    setTimeout(() => { button.textContent = original; }, 1800);
  }

  function contactBlock(item) {
    if (item.sold) {
      return el('p', { class: 'notice', text: 'This item has been sold.' });
    }
    if (!item.contact) {
      return el('p', { class: 'notice', text: 'The seller has not shared a contact number.' });
    }
    return el('div', { class: 'contact' },
      el('p', {}, 'Seller: ', el('strong', { text: item.sellerName })),
      el('p', {}, 'Phone / WhatsApp: ', el('strong', { class: 'phone', id: 'seller-phone', text: formatPhone(item.contact) })),
      el('div', { class: 'contact__actions' },
        el('a', { class: 'btn btn--primary', href: whatsappLink(item), target: '_blank', rel: 'noopener noreferrer', text: 'Chat on WhatsApp' }),
        el('button', { class: 'btn', type: 'button', text: 'Copy number', onclick: (e) => copyText(formatPhone(item.contact), e.currentTarget) })
      ),
      el('p', { class: 'hint', text: 'Meet in a public spot on campus and check the item before you pay.' })
    );
  }

  function ownerBlock(item, dialog) {
    if (!isMine(item)) return null;
    let armed = false;
    return el('div', { class: 'owner' },
      el('p', { class: 'owner__title', text: 'This is your listing' }),
      el('div', { class: 'owner__actions' },
        el('button', {
          class: 'btn', type: 'button',
          text: item.sold ? 'Mark as available' : 'Mark as sold',
          onclick: async () => {
            const next = !item.sold;
            try {
              await backend.setSold(item.id, next);
              closeDialog(dialog);
              toast(next ? 'Marked as sold.' : 'Your listing is live again.');
            } catch (err) {
              toast('Could not update the listing. Try again.');
            }
          }
        }),
        el('button', {
          class: 'btn btn--danger', type: 'button', text: 'Delete listing',
          onclick: async (e) => {
            if (!armed) {
              armed = true;
              e.currentTarget.textContent = 'Tap again to delete';
              return;
            }
            try {
              await backend.remove(item.id);
              closeDialog(dialog);
              toast('Listing deleted.');
            } catch (err) {
              toast('Could not delete the listing. Try again.');
            }
          }
        })
      )
    );
  }

  function openItem(id) {
    const item = state.listings.find((i) => i.id === id);
    if (!item) return;
    const dialog = $('#item-dialog');
    const images = item.images && item.images.length ? item.images : [placeholder(item.category)];
    const mainImg = el('img', { class: 'gallery__img', src: images[0], alt: item.title });

    const thumbs = images.length > 1
      ? el('div', { class: 'gallery__thumbs' }, images.map((src, i) =>
          el('button', {
            class: 'gallery__thumb', type: 'button', 'aria-label': 'Photo ' + (i + 1),
            'aria-pressed': String(i === 0),
            onclick: (e) => {
              mainImg.src = src;
              e.currentTarget.parentElement.querySelectorAll('button').forEach((b, j) => {
                b.setAttribute('aria-pressed', String(j === i));
              });
            }
          }, el('img', { src, alt: '' }))
        ))
      : null;

    const facts = [
      ['Condition', item.condition],
      ['Category', categoryOf(item.category).label],
      ['Hostel / area', item.hostel || 'Not mentioned'],
      ['Posted', timeAgo(item.createdAt)]
    ];

    $('#item-body').replaceChildren(
      el('div', { class: 'sheet__head' },
        el('h2', { class: 'detail__title', text: item.title }),
        el('button', { class: 'icon-btn', type: 'button', 'data-close': '', 'aria-label': 'Close' }, closeIcon())
      ),
      el('div', { class: 'gallery' }, el('div', { class: 'gallery__main' }, mainImg), thumbs),
      el('p', { class: 'detail__price', text: formatPrice(item.price) }),
      el('dl', { class: 'facts' }, facts.map(([k, v]) =>
        el('div', {}, el('dt', { text: k }), el('dd', { text: v }))
      )),
      item.description ? el('p', { class: 'detail__desc', text: item.description }) : null,
      contactBlock(item),
      ownerBlock(item, dialog)
    );
    openDialog(dialog);
  }

  /* ---------------------------------------------------------------
     5. SELL FORM
     --------------------------------------------------------------- */

  const FIELDS = ['title', 'price', 'category', 'condition', 'name', 'phone'];

  const FIELD_INPUT = {
    title: '#f-title', price: '#f-price', category: '#f-category',
    condition: '#f-condition', name: '#f-name', phone: '#f-phone'
  };

  function renderPhotoPreviews() {
    $('#photo-previews').replaceChildren(...state.photos.map((src, i) =>
      el('div', { class: 'thumb' },
        el('img', { src, alt: 'Photo ' + (i + 1) + ' preview' }),
        el('button', {
          type: 'button', 'aria-label': 'Remove photo ' + (i + 1),
          onclick: () => { state.photos.splice(i, 1); renderPhotoPreviews(); }
        }, closeIcon())
      )
    ));
    $('#photo-add').hidden = state.photos.length >= MAX_PHOTOS;
  }

  function showPhotoError(message) {
    const box = $('#err-photos');
    box.textContent = message;
    box.hidden = !message;
  }

  async function onPhotosChosen(input) {
    const files = Array.from(input.files);
    input.value = '';
    showPhotoError('');
    if (!files.length) return;
    const room = MAX_PHOTOS - state.photos.length;
    if (files.length > room) showPhotoError('You can add up to ' + MAX_PHOTOS + ' photos.');
    for (const file of files.slice(0, room)) {
      if (!file.type.startsWith('image/')) {
        showPhotoError('Only image files can be added.');
        continue;
      }
      try {
        state.photos.push(await compressPhoto(file));
      } catch (err) {
        showPhotoError('One photo could not be read. Try a JPG or PNG.');
      }
    }
    renderPhotoPreviews();
  }

  function normalizePhone(raw) {
    let digits = String(raw).replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
    return /^[6-9]\d{9}$/.test(digits) ? digits : null;
  }

  function readForm() {
    return {
      title: $('#f-title').value.trim(),
      priceRaw: $('#f-price').value.trim(),
      category: $('#f-category').value,
      condition: $('#f-condition').value,
      hostel: $('#f-hostel').value.trim(),
      description: $('#f-desc').value.trim(),
      name: $('#f-name').value.trim(),
      phone: normalizePhone($('#f-phone').value)
    };
  }

  function validate(v) {
    const errors = {};
    if (v.title.length < 3) errors.title = 'Enter a title of at least 3 characters.';
    const price = Number(v.priceRaw);
    if (v.priceRaw === '' || !Number.isInteger(price) || price < 0 || price > 1000000) {
      errors.price = 'Enter a price in whole rupees. Use 0 for free.';
    }
    if (!v.category) errors.category = 'Choose a category.';
    if (!v.condition) errors.condition = 'Choose the condition.';
    if (v.name.length < 2) errors.name = 'Enter your name.';
    if (!v.phone) errors.phone = 'Enter a valid 10-digit mobile number.';
    return errors;
  }

  function showErrors(errors) {
    FIELDS.forEach((field) => {
      const message = errors[field];
      const box = $('#err-' + field);
      const input = $(FIELD_INPUT[field]);
      box.hidden = !message;
      box.textContent = message || '';
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    });
  }

  function setSubmitError(message) {
    const box = $('#err-submit');
    box.textContent = message || '';
    box.hidden = !message;
  }

  function resetForm() {
    $('#sell-form').reset();
    state.photos = [];
    renderPhotoPreviews();
    showPhotoError('');
    setSubmitError('');
    showErrors({});
  }

  function openSell() {
    const profile = readJSON(PROFILE_KEY, {});
    if (!$('#f-name').value) $('#f-name').value = profile.name || (state.user ? state.user.name : '');
    if (!$('#f-phone').value && profile.phone) $('#f-phone').value = profile.phone;
    if (!$('#f-hostel').value && profile.hostel) $('#f-hostel').value = profile.hostel;
    closeDialog($('#item-dialog'));
    openDialog($('#sell-dialog'));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setSubmitError('');
    const v = readForm();
    const errors = validate(v);
    showErrors(errors);
    const firstBad = FIELDS.find((f) => errors[f]);
    if (firstBad) {
      $(FIELD_INPUT[firstBad]).focus();
      return;
    }
    if (state.photos.join('').length > MAX_IMAGE_CHARS) {
      showPhotoError('The photos are too large together. Remove one or choose smaller photos.');
      return;
    }

    const item = {
      title: v.title,
      price: Number(v.priceRaw),
      category: v.category,
      condition: v.condition,
      hostel: v.hostel,
      description: v.description,
      sellerName: v.name,
      sellerId: state.user.uid,
      contact: v.phone,
      images: state.photos.slice(),
      createdAt: Date.now(),
      sold: false
    };

    const button = $('#post-btn');
    setBusy(button, true, 'Post listing');
    try {
      await backend.add(item);
      writeJSON(PROFILE_KEY, { name: v.name, phone: v.phone, hostel: v.hostel });
      closeDialog($('#sell-dialog'));
      resetForm();
      state.view = 'all';
      clearFilters();
      toast('Your item is live. Students can now contact you.');
    } catch (err) {
      setSubmitError(err && err.code === 'permission-denied'
        ? 'Your account is not allowed to post. Sign in with your verified college email.'
        : 'Could not post your item. Check your internet connection and try again.');
    } finally {
      setBusy(button, false, 'Post listing');
    }
  }

  /* ---------------------------------------------------------------
     6. START-UP
     --------------------------------------------------------------- */

  function fillSelect(select, firstLabel, firstValue, options) {
    select.replaceChildren(
      el('option', { value: firstValue, text: firstLabel }),
      ...options.map((o) => el('option', { value: o.value, text: o.label }))
    );
  }

  function wireUi() {
    const catOptions = CATEGORIES.map((c) => ({ value: c.id, label: c.label }));
    const condOptions = CONDITIONS.map((c) => ({ value: c, label: c }));

    fillSelect($('#f-category'), 'Choose one', '', catOptions);
    fillSelect($('#f-condition'), 'Choose one', '', condOptions);
    fillSelect($('#f-cond-filter'), 'Any condition', 'all', condOptions);

    $('#chips').replaceChildren(
      el('button', { class: 'chip', type: 'button', 'data-cat': 'all', text: 'All', onclick: () => { state.cat = 'all'; render(); } }),
      ...CATEGORIES.map((c) =>
        el('button', { class: 'chip', type: 'button', 'data-cat': c.id, text: c.label, onclick: () => { state.cat = c.id; render(); } })
      )
    );

    $('#search-form').addEventListener('submit', (e) => e.preventDefault());
    $('#q').addEventListener('input', (e) => { state.q = e.target.value; render(); });
    $('#f-cond-filter').addEventListener('change', (e) => { state.cond = e.target.value; render(); });
    $('#f-max').addEventListener('input', (e) => { state.maxPrice = e.target.value; render(); });
    $('#f-sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

    $('#tab-all').addEventListener('click', () => { state.view = 'all'; render(); });
    $('#tab-mine').addEventListener('click', () => { state.view = 'mine'; render(); });

    $('#sell-btn').addEventListener('click', openSell);
    $('#sell-form').addEventListener('submit', onSubmit);
    $('#photo-add').addEventListener('click', () => $('#f-photos').click());
    $('#f-photos').addEventListener('change', (e) => onPhotosChosen(e.target));

    $('#mode-signin').addEventListener('click', () => setAuthMode('signin'));
    $('#mode-signup').addEventListener('click', () => setAuthMode('signup'));
    $('#auth-form').addEventListener('submit', onAuthSubmit);
    $('#google-btn').addEventListener('click', onGoogle);
    $('#signout-btn').addEventListener('click', () => backend.signOut());
    $('#verify-done').addEventListener('click', onVerifyDone);
    $('#verify-resend').addEventListener('click', onVerifyResend);
    $('#verify-out').addEventListener('click', () => backend.signOut());

    document.addEventListener('click', (e) => {
      const closer = e.target.closest('[data-close]');
      if (closer) closeDialog(closer.closest('dialog'));
      if (e.target.tagName === 'DIALOG') closeDialog(e.target);
    });

    const example = ALLOWED_DOMAINS.length ? 'name@' + ALLOWED_DOMAINS[0] : 'name@college.edu';
    $('#a-email').setAttribute('placeholder', example);
    if (ALLOWED_DOMAINS.length) {
      $('#gate-lead').textContent = 'Only students with a college email (' +
        ALLOWED_DOMAINS.map((d) => '@' + d).join(' or ') +
        ') can buy and sell here, so everyone you meet on the board is a real student.';
    }

    renderPhotoPreviews();
  }

  function setupProblem() {
    const fb = CONFIG.firebase || {};
    if (!fb.apiKey || !fb.authDomain || !fb.projectId || !fb.appId) {
      return 'The Firebase keys are missing in firebase-config.js.';
    }
    const badDomain = ALLOWED_DOMAINS.some((d) => d.includes('yourcollege') || !d.includes('.'));
    if (!ALLOWED_DOMAINS.length || badDomain) {
      return 'The college email domain is not set in firebase-config.js.';
    }
    return '';
  }

  function showSetupNeeded(reason) {
    showScreen('auth');
    $('#auth-real').hidden = true;
    $('#gate-title').textContent = 'Campus Bazaar is not set up yet';
    $('#gate-lead').textContent = 'Nobody can sign in until the site owner finishes setup. ' + reason + ' README.md explains the steps.';
  }

  async function start() {
    wireUi();

    const problem = setupProblem();
    if (problem) {
      showSetupNeeded(problem);
      return;
    }

    try {
      backend = await createFirebaseBackend(CONFIG.firebase);
    } catch (err) {
      showSetupNeeded('Could not connect to Firebase. Check the keys in firebase-config.js and your internet connection, and open the site through http://localhost or your hosting address, not by double-clicking the file.');
      return;
    }

    $('#auth-real').hidden = false;
    backend.onAuth(handleUser);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
