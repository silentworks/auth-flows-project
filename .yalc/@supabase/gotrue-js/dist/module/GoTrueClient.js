var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import GoTrueAdminApi from './GoTrueAdminApi';
import { DEFAULT_HEADERS, EXPIRY_MARGIN, GOTRUE_URL, STORAGE_KEY } from './lib/constants';
import { AuthImplicitGrantRedirectError, AuthPKCEGrantCodeExchangeError, AuthInvalidCredentialsError, AuthSessionMissingError, AuthInvalidTokenResponseError, AuthUnknownError, isAuthApiError, isAuthError, isAuthRetryableFetchError, } from './lib/errors';
import { _request, _sessionResponse, _userResponse, _ssoResponse } from './lib/fetch';
import { decodeJWTPayload, Deferred, getItemAsync, getParameterByName, isBrowser, removeItemAsync, resolveFetch, setItemAsync, uuid, retryable, sleep, generatePKCEVerifier, generatePKCEChallenge, supportsLocalStorage, } from './lib/helpers';
import localStorageAdapter from './lib/local-storage';
import { polyfillGlobalThis } from './lib/polyfills';
polyfillGlobalThis(); // Make "globalThis" available
const DEFAULT_OPTIONS = {
    url: GOTRUE_URL,
    storageKey: STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    headers: DEFAULT_HEADERS,
    flowType: 'implicit',
    debug: false,
};
/** Current session will be checked for refresh at this interval. */
const AUTO_REFRESH_TICK_DURATION = 30 * 1000;
/**
 * A token refresh will be attempted this many ticks before the current session expires. */
const AUTO_REFRESH_TICK_THRESHOLD = 3;
export default class GoTrueClient {
    /**
     * Create a new client for use in the browser.
     */
    constructor(options) {
        var _a;
        this.stateChangeEmitters = new Map();
        this.autoRefreshTicker = null;
        this.visibilityChangedCallback = null;
        this.refreshingDeferred = null;
        /**
         * Keeps track of the async client initialization.
         * When null or not yet resolved the auth state is `unknown`
         * Once resolved the the auth state is known and it's save to call any further client methods.
         * Keep extra care to never reject or throw uncaught errors
         */
        this.initializePromise = null;
        this.detectSessionInUrl = true;
        /**
         * Used to broadcast state change events to other tabs listening.
         */
        this.broadcastChannel = null;
        this.instanceID = GoTrueClient.nextInstanceID;
        GoTrueClient.nextInstanceID += 1;
        if (this.instanceID > 0 && isBrowser()) {
            console.warn('Multiple GoTrueClient instances detected in the same browser context. It is not an error, but this should be avoided as it may produce undefined behavior when used concurrently under the same storage key.');
        }
        const settings = Object.assign(Object.assign({}, DEFAULT_OPTIONS), options);
        this.logDebugMessages = settings.debug;
        this.inMemorySession = null;
        this.storageKey = settings.storageKey;
        this.autoRefreshToken = settings.autoRefreshToken;
        this.persistSession = settings.persistSession;
        this.storage = settings.storage || localStorageAdapter;
        this.admin = new GoTrueAdminApi({
            url: settings.url,
            headers: settings.headers,
            fetch: settings.fetch,
        });
        this.url = settings.url;
        this.headers = settings.headers;
        this.fetch = resolveFetch(settings.fetch);
        this.detectSessionInUrl = settings.detectSessionInUrl;
        this.flowType = settings.flowType;
        this.mfa = {
            verify: this._verify.bind(this),
            enroll: this._enroll.bind(this),
            unenroll: this._unenroll.bind(this),
            challenge: this._challenge.bind(this),
            listFactors: this._listFactors.bind(this),
            challengeAndVerify: this._challengeAndVerify.bind(this),
            getAuthenticatorAssuranceLevel: this._getAuthenticatorAssuranceLevel.bind(this),
        };
        if (this.persistSession && this.storage === localStorageAdapter && !supportsLocalStorage()) {
            console.warn(`No storage option exists to persist the session, which may result in unexpected behavior when using auth.
        If you want to set persistSession to true, please provide a storage option or you may set persistSession to false to disable this warning.`);
        }
        if (isBrowser() && globalThis.BroadcastChannel && this.persistSession && this.storageKey) {
            try {
                this.broadcastChannel = new globalThis.BroadcastChannel(this.storageKey);
            }
            catch (e) {
                console.error('Failed to create a new BroadcastChannel, multi-tab state changes will not be available', e);
            }
            (_a = this.broadcastChannel) === null || _a === void 0 ? void 0 : _a.addEventListener('message', (event) => __awaiter(this, void 0, void 0, function* () {
                this._debug('received broadcast notification from other tab or client', event);
                yield this._notifyAllSubscribers(event.data.event, event.data.session, false); // broadcast = false so we don't get an endless loop of messages
            }));
        }
        this.initialize();
    }
    _debug(...args) {
        if (this.logDebugMessages) {
            console.log(`GoTrueClient@${this.instanceID} ${new Date().toISOString()}`, ...args);
        }
        return this;
    }
    /**
     * Initializes the client session either from the url or from storage.
     * This method is automatically called when instantiating the client, but should also be called
     * manually when checking for an error from an auth redirect (oauth, magiclink, password recovery, etc).
     */
    initialize() {
        if (!this.initializePromise) {
            this.initializePromise = this._initialize();
        }
        return this.initializePromise;
    }
    /**
     * IMPORTANT:
     * 1. Never throw in this method, as it is called from the constructor
     * 2. Never return a session from this method as it would be cached over
     *    the whole lifetime of the client
     */
    _initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.initializePromise) {
                return this.initializePromise;
            }
            try {
                const isPKCEFlow = isBrowser() ? yield this._isPKCEFlow() : false;
                this._debug('#_initialize()', 'begin', 'is PKCE flow', isPKCEFlow);
                if (isPKCEFlow || (this.detectSessionInUrl && this._isImplicitGrantFlow())) {
                    const { data, error } = yield this._getSessionFromUrl(isPKCEFlow);
                    if (error) {
                        this._debug('#_initialize()', 'error detecting session from URL', error);
                        // failed login attempt via url,
                        // remove old session as in verifyOtp, signUp and signInWith*
                        yield this._removeSession();
                        return { error };
                    }
                    const { session, redirectType } = data;
                    this._debug('#_initialize()', 'detected session in URL', session, 'redirect type', redirectType);
                    yield this._saveSession(session);
                    setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                        if (redirectType === 'recovery') {
                            yield this._notifyAllSubscribers('PASSWORD_RECOVERY', session);
                        }
                        else {
                            yield this._notifyAllSubscribers('SIGNED_IN', session);
                        }
                    }), 0);
                    return { error: null };
                }
                // no login attempt via callback url try to recover session from storage
                yield this._recoverAndRefresh();
                return { error: null };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { error };
                }
                return {
                    error: new AuthUnknownError('Unexpected error during initialization', error),
                };
            }
            finally {
                yield this._handleVisibilityChange();
                this._debug('#_initialize()', 'end');
            }
        });
    }
    /**
     * Creates a new user.
     *
     * Be aware that if a user account exists in the system you may get back an
     * error message that attempts to hide this information from the user.
     * This method has support for PKCE via email signups. The PKCE flow cannot be used when autoconfirm is enabled.
     *
     * @returns A logged-in session if the server has "autoconfirm" ON
     * @returns A user if the server has "autoconfirm" OFF
     */
    signUp(credentials) {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this._removeSession();
                let res;
                if ('email' in credentials) {
                    const { email, password, options } = credentials;
                    let codeChallenge = null;
                    let codeChallengeMethod = null;
                    if (this.flowType === 'pkce') {
                        const codeVerifier = generatePKCEVerifier();
                        yield setItemAsync(this.storage, `${this.storageKey}-code-verifier`, codeVerifier);
                        codeChallenge = yield generatePKCEChallenge(codeVerifier);
                        codeChallengeMethod = codeVerifier === codeChallenge ? 'plain' : 's256';
                    }
                    res = yield _request(this.fetch, 'POST', `${this.url}/signup`, {
                        headers: this.headers,
                        redirectTo: options === null || options === void 0 ? void 0 : options.emailRedirectTo,
                        body: {
                            email,
                            password,
                            data: (_a = options === null || options === void 0 ? void 0 : options.data) !== null && _a !== void 0 ? _a : {},
                            gotrue_meta_security: { captcha_token: options === null || options === void 0 ? void 0 : options.captchaToken },
                            code_challenge: codeChallenge,
                            code_challenge_method: codeChallengeMethod,
                        },
                        xform: _sessionResponse,
                    });
                }
                else if ('phone' in credentials) {
                    const { phone, password, options } = credentials;
                    res = yield _request(this.fetch, 'POST', `${this.url}/signup`, {
                        headers: this.headers,
                        body: {
                            phone,
                            password,
                            data: (_b = options === null || options === void 0 ? void 0 : options.data) !== null && _b !== void 0 ? _b : {},
                            channel: (_c = options === null || options === void 0 ? void 0 : options.channel) !== null && _c !== void 0 ? _c : 'sms',
                            gotrue_meta_security: { captcha_token: options === null || options === void 0 ? void 0 : options.captchaToken },
                        },
                        xform: _sessionResponse,
                    });
                }
                else {
                    throw new AuthInvalidCredentialsError('You must provide either an email or phone number and a password');
                }
                const { data, error } = res;
                if (error || !data) {
                    return { data: { user: null, session: null }, error: error };
                }
                const session = data.session;
                const user = data.user;
                if (data.session) {
                    yield this._saveSession(data.session);
                    yield this._notifyAllSubscribers('SIGNED_IN', session);
                }
                return { data: { user, session }, error: null };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { user: null, session: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Log in an existing user with an email and password or phone and password.
     *
     * Be aware that you may get back an error message that will not distinguish
     * between the cases where the account does not exist or that the
     * email/phone and password combination is wrong or that the account can only
     * be accessed via social login.
     */
    signInWithPassword(credentials) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this._removeSession();
                let res;
                if ('email' in credentials) {
                    const { email, password, options } = credentials;
                    res = yield _request(this.fetch, 'POST', `${this.url}/token?grant_type=password`, {
                        headers: this.headers,
                        body: {
                            email,
                            password,
                            gotrue_meta_security: { captcha_token: options === null || options === void 0 ? void 0 : options.captchaToken },
                        },
                        xform: _sessionResponse,
                    });
                }
                else if ('phone' in credentials) {
                    const { phone, password, options } = credentials;
                    res = yield _request(this.fetch, 'POST', `${this.url}/token?grant_type=password`, {
                        headers: this.headers,
                        body: {
                            phone,
                            password,
                            gotrue_meta_security: { captcha_token: options === null || options === void 0 ? void 0 : options.captchaToken },
                        },
                        xform: _sessionResponse,
                    });
                }
                else {
                    throw new AuthInvalidCredentialsError('You must provide either an email or phone number and a password');
                }
                const { data, error } = res;
                if (error) {
                    return { data: { user: null, session: null }, error };
                }
                else if (!data || !data.session || !data.user) {
                    return { data: { user: null, session: null }, error: new AuthInvalidTokenResponseError() };
                }
                if (data.session) {
                    yield this._saveSession(data.session);
                    yield this._notifyAllSubscribers('SIGNED_IN', data.session);
                }
                return { data: { user: data.user, session: data.session }, error };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { user: null, session: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Log in an existing user via a third-party provider.
     * This method supports the PKCE flow.
     */
    signInWithOAuth(credentials) {
        var _a, _b, _c, _d;
        return __awaiter(this, void 0, void 0, function* () {
            yield this._removeSession();
            return yield this._handleProviderSignIn(credentials.provider, {
                redirectTo: (_a = credentials.options) === null || _a === void 0 ? void 0 : _a.redirectTo,
                scopes: (_b = credentials.options) === null || _b === void 0 ? void 0 : _b.scopes,
                queryParams: (_c = credentials.options) === null || _c === void 0 ? void 0 : _c.queryParams,
                skipBrowserRedirect: (_d = credentials.options) === null || _d === void 0 ? void 0 : _d.skipBrowserRedirect,
            });
        });
    }
    /**
     * Log in an existing user by exchanging an Auth Code issued during the PKCE flow.
     */
    exchangeCodeForSession(authCode) {
        return __awaiter(this, void 0, void 0, function* () {
            const codeVerifier = yield getItemAsync(this.storage, `${this.storageKey}-code-verifier`);
            const { data, error } = yield _request(this.fetch, 'POST', `${this.url}/token?grant_type=pkce`, {
                headers: this.headers,
                body: {
                    auth_code: authCode,
                    code_verifier: codeVerifier,
                },
                xform: _sessionResponse,
            });
            yield removeItemAsync(this.storage, `${this.storageKey}-code-verifier`);
            if (error) {
                return { data: { user: null, session: null }, error };
            }
            else if (!data || !data.session || !data.user) {
                return { data: { user: null, session: null }, error: new AuthInvalidTokenResponseError() };
            }
            if (data.session) {
                yield this._saveSession(data.session);
                yield this._notifyAllSubscribers('SIGNED_IN', data.session);
            }
            return { data, error };
        });
    }
    /**
     * Allows signing in with an OIDC ID token. The authentication provider used
     * should be enabled and configured.
     */
    signInWithIdToken(credentials) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._removeSession();
            try {
                const { options, provider, token, access_token, nonce } = credentials;
                const res = yield _request(this.fetch, 'POST', `${this.url}/token?grant_type=id_token`, {
                    headers: this.headers,
                    body: {
                        provider,
                        id_token: token,
                        access_token,
                        nonce,
                        gotrue_meta_security: { captcha_token: options === null || options === void 0 ? void 0 : options.captchaToken },
                    },
                    xform: _sessionResponse,
                });
                const { data, error } = res;
                if (error) {
                    return { data: { user: null, session: null }, error };
                }
                else if (!data || !data.session || !data.user) {
                    return {
                        data: { user: null, session: null },
                        error: new AuthInvalidTokenResponseError(),
                    };
                }
                if (data.session) {
                    yield this._saveSession(data.session);
                    yield this._notifyAllSubscribers('SIGNED_IN', data.session);
                }
                return { data, error };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { user: null, session: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Log in a user using magiclink or a one-time password (OTP).
     *
     * If the `{{ .ConfirmationURL }}` variable is specified in the email template, a magiclink will be sent.
     * If the `{{ .Token }}` variable is specified in the email template, an OTP will be sent.
     * If you're using phone sign-ins, only an OTP will be sent. You won't be able to send a magiclink for phone sign-ins.
     *
     * Be aware that you may get back an error message that will not distinguish
     * between the cases where the account does not exist or, that the account
     * can only be accessed via social login.
     *
     * Do note that you will need to configure a Whatsapp sender on Twilio
     * if you are using phone sign in with the 'whatsapp' channel. The whatsapp
     * channel is not supported on other providers
     * at this time.
     * This method supports PKCE when an email is passed.
     */
    signInWithOtp(credentials) {
        var _a, _b, _c, _d, _e;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this._removeSession();
                if ('email' in credentials) {
                    const { email, options } = credentials;
                    let codeChallenge = null;
                    let codeChallengeMethod = null;
                    if (this.flowType === 'pkce') {
                        const codeVerifier = generatePKCEVerifier();
                        yield setItemAsync(this.storage, `${this.storageKey}-code-verifier`, codeVerifier);
                        codeChallenge = yield generatePKCEChallenge(codeVerifier);
                        codeChallengeMethod = codeVerifier === codeChallenge ? 'plain' : 's256';
                    }
                    const { error } = yield _request(this.fetch, 'POST', `${this.url}/otp`, {
                        headers: this.headers,
                        body: {
                            email,
                            data: (_a = options === null || options === void 0 ? void 0 : options.data) !== null && _a !== void 0 ? _a : {},
                            create_user: (_b = options === null || options === void 0 ? void 0 : options.shouldCreateUser) !== null && _b !== void 0 ? _b : true,
                            gotrue_meta_security: { captcha_token: options === null || options === void 0 ? void 0 : options.captchaToken },
                            code_challenge: codeChallenge,
                            code_challenge_method: codeChallengeMethod,
                        },
                        redirectTo: options === null || options === void 0 ? void 0 : options.emailRedirectTo,
                    });
                    return { data: { user: null, session: null }, error };
                }
                if ('phone' in credentials) {
                    const { phone, options } = credentials;
                    const { data, error } = yield _request(this.fetch, 'POST', `${this.url}/otp`, {
                        headers: this.headers,
                        body: {
                            phone,
                            data: (_c = options === null || options === void 0 ? void 0 : options.data) !== null && _c !== void 0 ? _c : {},
                            create_user: (_d = options === null || options === void 0 ? void 0 : options.shouldCreateUser) !== null && _d !== void 0 ? _d : true,
                            gotrue_meta_security: { captcha_token: options === null || options === void 0 ? void 0 : options.captchaToken },
                            channel: (_e = options === null || options === void 0 ? void 0 : options.channel) !== null && _e !== void 0 ? _e : 'sms',
                        },
                    });
                    return { data: { user: null, session: null, messageId: data === null || data === void 0 ? void 0 : data.message_id }, error };
                }
                throw new AuthInvalidCredentialsError('You must provide either an email or phone number.');
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { user: null, session: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Log in a user given a User supplied OTP received via mobile.
     */
    verifyOtp(params) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (params.type !== 'email_change' && params.type !== 'phone_change') {
                    // we don't want to remove the authenticated session if the user is performing an email_change or phone_change verification
                    yield this._removeSession();
                }
                const { data, error } = yield _request(this.fetch, 'POST', `${this.url}/verify`, {
                    headers: this.headers,
                    body: Object.assign(Object.assign({}, params), { gotrue_meta_security: { captcha_token: (_a = params.options) === null || _a === void 0 ? void 0 : _a.captchaToken } }),
                    redirectTo: (_b = params.options) === null || _b === void 0 ? void 0 : _b.redirectTo,
                    xform: _sessionResponse,
                });
                if (error) {
                    throw error;
                }
                if (!data) {
                    throw new Error('An error occurred on token verification.');
                }
                const session = data.session;
                const user = data.user;
                if (session === null || session === void 0 ? void 0 : session.access_token) {
                    yield this._saveSession(session);
                    yield this._notifyAllSubscribers('SIGNED_IN', session);
                }
                return { data: { user, session }, error: null };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { user: null, session: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Attempts a single-sign on using an enterprise Identity Provider. A
     * successful SSO attempt will redirect the current page to the identity
     * provider authorization page. The redirect URL is implementation and SSO
     * protocol specific.
     *
     * You can use it by providing a SSO domain. Typically you can extract this
     * domain by asking users for their email address. If this domain is
     * registered on the Auth instance the redirect will use that organization's
     * currently active SSO Identity Provider for the login.
     *
     * If you have built an organization-specific login page, you can use the
     * organization's SSO Identity Provider UUID directly instead.
     */
    signInWithSSO(params) {
        var _a, _b, _c;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this._removeSession();
                return yield _request(this.fetch, 'POST', `${this.url}/sso`, {
                    body: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, ('providerId' in params ? { provider_id: params.providerId } : null)), ('domain' in params ? { domain: params.domain } : null)), { redirect_to: (_b = (_a = params.options) === null || _a === void 0 ? void 0 : _a.redirectTo) !== null && _b !== void 0 ? _b : undefined }), (((_c = params === null || params === void 0 ? void 0 : params.options) === null || _c === void 0 ? void 0 : _c.captchaToken)
                        ? { gotrue_meta_security: { captcha_token: params.options.captchaToken } }
                        : null)), { skip_http_redirect: true }),
                    headers: this.headers,
                    xform: _ssoResponse,
                });
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: null, error };
                }
                throw error;
            }
        });
    }
    /**
     * Sends a reauthentication OTP to the user's email or phone number.
     * Requires the user to be signed-in.
     */
    reauthenticate() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { data: { session }, error: sessionError, } = yield this.getSession();
                if (sessionError)
                    throw sessionError;
                if (!session)
                    throw new AuthSessionMissingError();
                const { error } = yield _request(this.fetch, 'GET', `${this.url}/reauthenticate`, {
                    headers: this.headers,
                    jwt: session.access_token,
                });
                return { data: { user: null, session: null }, error };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { user: null, session: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Resends an existing signup confirmation email, email change email, SMS OTP or phone change OTP.
     */
    resend(credentials) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this._removeSession();
                const endpoint = `${this.url}/resend`;
                if ('email' in credentials) {
                    const { email, type, options } = credentials;
                    const { error } = yield _request(this.fetch, 'POST', endpoint, {
                        headers: this.headers,
                        body: {
                            email,
                            type,
                            gotrue_meta_security: { captcha_token: options === null || options === void 0 ? void 0 : options.captchaToken },
                        },
                    });
                    return { data: { user: null, session: null }, error };
                }
                else if ('phone' in credentials) {
                    const { phone, type, options } = credentials;
                    const { data, error } = yield _request(this.fetch, 'POST', endpoint, {
                        headers: this.headers,
                        body: {
                            phone,
                            type,
                            gotrue_meta_security: { captcha_token: options === null || options === void 0 ? void 0 : options.captchaToken },
                        },
                    });
                    return { data: { user: null, session: null, messageId: data === null || data === void 0 ? void 0 : data.message_id }, error };
                }
                throw new AuthInvalidCredentialsError('You must provide either an email or phone number and a type');
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { user: null, session: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Returns the session, refreshing it if necessary.
     * The session returned can be null if the session is not detected which can happen in the event a user is not signed-in or has logged out.
     */
    getSession() {
        return __awaiter(this, void 0, void 0, function* () {
            // make sure we've read the session from the url if there is one
            // save to just await, as long we make sure _initialize() never throws
            yield this.initializePromise;
            this._debug('#getSession()', 'begin');
            try {
                let currentSession = null;
                if (this.persistSession) {
                    const maybeSession = yield getItemAsync(this.storage, this.storageKey);
                    this._debug('#getSession()', 'session from storage', maybeSession);
                    if (maybeSession !== null) {
                        if (this._isValidSession(maybeSession)) {
                            currentSession = maybeSession;
                        }
                        else {
                            this._debug('#getSession()', 'session from storage is not valid');
                            yield this._removeSession();
                        }
                    }
                }
                else {
                    currentSession = this.inMemorySession;
                    this._debug('#getSession()', 'session from memory', currentSession);
                }
                if (!currentSession) {
                    return { data: { session: null }, error: null };
                }
                const hasExpired = currentSession.expires_at
                    ? currentSession.expires_at <= Date.now() / 1000
                    : false;
                this._debug('#getSession()', `session has${hasExpired ? '' : ' not'} expired`, 'expires_at', currentSession.expires_at);
                if (!hasExpired) {
                    return { data: { session: currentSession }, error: null };
                }
                const { session, error } = yield this._callRefreshToken(currentSession.refresh_token);
                if (error) {
                    return { data: { session: null }, error };
                }
                return { data: { session }, error: null };
            }
            finally {
                this._debug('#getSession()', 'end');
            }
        });
    }
    /**
     * Gets the current user details if there is an existing session.
     * @param jwt Takes in an optional access token jwt. If no jwt is provided, getUser() will attempt to get the jwt from the current session.
     */
    getUser(jwt) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!jwt) {
                    const { data, error } = yield this.getSession();
                    if (error) {
                        throw error;
                    }
                    // Default to Authorization header if there is no existing session
                    jwt = (_b = (_a = data.session) === null || _a === void 0 ? void 0 : _a.access_token) !== null && _b !== void 0 ? _b : undefined;
                }
                return yield _request(this.fetch, 'GET', `${this.url}/user`, {
                    headers: this.headers,
                    jwt: jwt,
                    xform: _userResponse,
                });
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { user: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Updates user data for a logged in user.
     */
    updateUser(attributes, options = {}) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { data: sessionData, error: sessionError } = yield this.getSession();
                if (sessionError) {
                    throw sessionError;
                }
                if (!sessionData.session) {
                    throw new AuthSessionMissingError();
                }
                const session = sessionData.session;
                const { data, error: userError } = yield _request(this.fetch, 'PUT', `${this.url}/user`, {
                    headers: this.headers,
                    redirectTo: options === null || options === void 0 ? void 0 : options.emailRedirectTo,
                    body: attributes,
                    jwt: session.access_token,
                    xform: _userResponse,
                });
                if (userError)
                    throw userError;
                session.user = data.user;
                yield this._saveSession(session);
                yield this._notifyAllSubscribers('USER_UPDATED', session);
                return { data: { user: session.user }, error: null };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { user: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Decodes a JWT (without performing any validation).
     */
    _decodeJWT(jwt) {
        return decodeJWTPayload(jwt);
    }
    /**
     * Sets the session data from the current session. If the current session is expired, setSession will take care of refreshing it to obtain a new session.
     * If the refresh token or access token in the current session is invalid, an error will be thrown.
     * @param currentSession The current session that minimally contains an access token and refresh token.
     */
    setSession(currentSession) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!currentSession.access_token || !currentSession.refresh_token) {
                    throw new AuthSessionMissingError();
                }
                const timeNow = Date.now() / 1000;
                let expiresAt = timeNow;
                let hasExpired = true;
                let session = null;
                const payload = decodeJWTPayload(currentSession.access_token);
                if (payload.exp) {
                    expiresAt = payload.exp;
                    hasExpired = expiresAt <= timeNow;
                }
                if (hasExpired) {
                    const { session: refreshedSession, error } = yield this._callRefreshToken(currentSession.refresh_token);
                    if (error) {
                        return { data: { user: null, session: null }, error: error };
                    }
                    if (!refreshedSession) {
                        return { data: { user: null, session: null }, error: null };
                    }
                    session = refreshedSession;
                }
                else {
                    const { data, error } = yield this.getUser(currentSession.access_token);
                    if (error) {
                        throw error;
                    }
                    session = {
                        access_token: currentSession.access_token,
                        refresh_token: currentSession.refresh_token,
                        user: data.user,
                        token_type: 'bearer',
                        expires_in: expiresAt - timeNow,
                        expires_at: expiresAt,
                    };
                    yield this._saveSession(session);
                    yield this._notifyAllSubscribers('SIGNED_IN', session);
                }
                return { data: { user: session.user, session }, error: null };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { session: null, user: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Returns a new session, regardless of expiry status.
     * Takes in an optional current session. If not passed in, then refreshSession() will attempt to retrieve it from getSession().
     * If the current session's refresh token is invalid, an error will be thrown.
     * @param currentSession The current session. If passed in, it must contain a refresh token.
     */
    refreshSession(currentSession) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!currentSession) {
                    const { data, error } = yield this.getSession();
                    if (error) {
                        throw error;
                    }
                    currentSession = (_a = data.session) !== null && _a !== void 0 ? _a : undefined;
                }
                if (!(currentSession === null || currentSession === void 0 ? void 0 : currentSession.refresh_token)) {
                    throw new AuthSessionMissingError();
                }
                const { session, error } = yield this._callRefreshToken(currentSession.refresh_token);
                if (error) {
                    return { data: { user: null, session: null }, error: error };
                }
                if (!session) {
                    return { data: { user: null, session: null }, error: null };
                }
                return { data: { user: session.user, session }, error: null };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { user: null, session: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Gets the session data from a URL string
     */
    _getSessionFromUrl(isPKCEFlow) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (!isBrowser())
                    throw new AuthImplicitGrantRedirectError('No browser detected.');
                if (this.flowType === 'implicit' && !this._isImplicitGrantFlow()) {
                    throw new AuthImplicitGrantRedirectError('Not a valid implicit grant flow url.');
                }
                else if (this.flowType == 'pkce' && !isPKCEFlow) {
                    throw new AuthPKCEGrantCodeExchangeError('Not a valid PKCE flow url.');
                }
                if (isPKCEFlow) {
                    const authCode = getParameterByName('code');
                    if (!authCode)
                        throw new AuthPKCEGrantCodeExchangeError('No code detected.');
                    const { data, error } = yield this.exchangeCodeForSession(authCode);
                    if (error)
                        throw error;
                    if (!data.session)
                        throw new AuthPKCEGrantCodeExchangeError('No session detected.');
                    let url = new URL(window.location.href);
                    url.searchParams.delete('code');
                    window.history.replaceState(window.history.state, '', url.toString());
                    return { data: { session: data.session, redirectType: null }, error: null };
                }
                const error_description = getParameterByName('error_description');
                if (error_description) {
                    const error_code = getParameterByName('error_code');
                    if (!error_code)
                        throw new AuthImplicitGrantRedirectError('No error_code detected.');
                    const error = getParameterByName('error');
                    if (!error)
                        throw new AuthImplicitGrantRedirectError('No error detected.');
                    throw new AuthImplicitGrantRedirectError(error_description, { error, code: error_code });
                }
                const provider_token = getParameterByName('provider_token');
                const provider_refresh_token = getParameterByName('provider_refresh_token');
                const access_token = getParameterByName('access_token');
                if (!access_token)
                    throw new AuthImplicitGrantRedirectError('No access_token detected.');
                const expires_in = getParameterByName('expires_in');
                if (!expires_in)
                    throw new AuthImplicitGrantRedirectError('No expires_in detected.');
                const refresh_token = getParameterByName('refresh_token');
                if (!refresh_token)
                    throw new AuthImplicitGrantRedirectError('No refresh_token detected.');
                const token_type = getParameterByName('token_type');
                if (!token_type)
                    throw new AuthImplicitGrantRedirectError('No token_type detected.');
                const timeNow = Math.round(Date.now() / 1000);
                const expires_at = timeNow + parseInt(expires_in);
                const { data, error } = yield this.getUser(access_token);
                if (error)
                    throw error;
                const user = data.user;
                const session = {
                    provider_token,
                    provider_refresh_token,
                    access_token,
                    expires_in: parseInt(expires_in),
                    expires_at,
                    refresh_token,
                    token_type,
                    user,
                };
                const redirectType = getParameterByName('type');
                // Remove tokens from URL
                window.location.hash = '';
                this._debug('#_getSessionFromUrl()', 'clearing window.location.hash');
                return { data: { session, redirectType }, error: null };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: { session: null, redirectType: null }, error };
                }
                throw error;
            }
        });
    }
    /**
     * Checks if the current URL contains parameters given by an implicit oauth grant flow (https://www.rfc-editor.org/rfc/rfc6749.html#section-4.2)
     */
    _isImplicitGrantFlow() {
        return (isBrowser() &&
            (Boolean(getParameterByName('access_token')) ||
                Boolean(getParameterByName('error_description'))));
    }
    /**
     * Checks if the current URL and backing storage contain parameters given by a PKCE flow
     */
    _isPKCEFlow() {
        return __awaiter(this, void 0, void 0, function* () {
            const currentStorageContent = yield getItemAsync(this.storage, `${this.storageKey}-code-verifier`);
            return Boolean(getParameterByName('code')) && Boolean(currentStorageContent);
        });
    }
    /**
     * Inside a browser context, `signOut()` will remove the logged in user from the browser session
     * and log them out - removing all items from localstorage and then trigger a `"SIGNED_OUT"` event.
     *
     * For server-side management, you can revoke all refresh tokens for a user by passing a user's JWT through to `auth.api.signOut(JWT: string)`.
     * There is no way to revoke a user's access token jwt until it expires. It is recommended to set a shorter expiry on the jwt for this reason.
     *
     * If using others scope, no `SIGNED_OUT` event is fired!
     */
    signOut({ scope } = { scope: 'global' }) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const { data, error: sessionError } = yield this.getSession();
            if (sessionError) {
                return { error: sessionError };
            }
            const accessToken = (_a = data.session) === null || _a === void 0 ? void 0 : _a.access_token;
            if (accessToken) {
                const { error } = yield this.admin.signOut(accessToken, scope);
                if (error) {
                    // ignore 404s since user might not exist anymore
                    // ignore 401s since an invalid or expired JWT should sign out the current session
                    if (!(isAuthApiError(error) && (error.status === 404 || error.status === 401))) {
                        return { error };
                    }
                }
            }
            if (scope !== 'others') {
                yield this._removeSession();
                yield removeItemAsync(this.storage, `${this.storageKey}-code-verifier`);
                yield this._notifyAllSubscribers('SIGNED_OUT', null);
            }
            return { error: null };
        });
    }
    /**
     * Receive a notification every time an auth event happens.
     * @param callback A callback function to be invoked when an auth event happens.
     */
    onAuthStateChange(callback) {
        const id = uuid();
        const subscription = {
            id,
            callback,
            unsubscribe: () => {
                this._debug('#unsubscribe()', 'state change callback with id removed', id);
                this.stateChangeEmitters.delete(id);
            },
        };
        this._debug('#onAuthStateChange()', 'registered callback with id', id);
        this.stateChangeEmitters.set(id, subscription);
        this._emitInitialSession(id);
        return { data: { subscription } };
    }
    _emitInitialSession(id) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { data: { session }, error, } = yield this.getSession();
                if (error)
                    throw error;
                yield ((_a = this.stateChangeEmitters.get(id)) === null || _a === void 0 ? void 0 : _a.callback('INITIAL_SESSION', session));
                this._debug('INITIAL_SESSION', 'callback id', id, 'session', session);
            }
            catch (err) {
                yield ((_b = this.stateChangeEmitters.get(id)) === null || _b === void 0 ? void 0 : _b.callback('INITIAL_SESSION', null));
                this._debug('INITIAL_SESSION', 'callback id', id, 'error', err);
                console.error(err);
            }
        });
    }
    /**
     * Sends a password reset request to an email address.
     * This method supports the PKCE flow.
     * @param email The email address of the user.
     * @param options.redirectTo The URL to send the user to after they click the password reset link.
     * @param options.captchaToken Verification token received when the user completes the captcha on the site.
     */
    resetPasswordForEmail(email, options = {}) {
        return __awaiter(this, void 0, void 0, function* () {
            let codeChallenge = null;
            let codeChallengeMethod = null;
            if (this.flowType === 'pkce') {
                const codeVerifier = generatePKCEVerifier();
                yield setItemAsync(this.storage, `${this.storageKey}-code-verifier`, codeVerifier);
                codeChallenge = yield generatePKCEChallenge(codeVerifier);
                codeChallengeMethod = codeVerifier === codeChallenge ? 'plain' : 's256';
            }
            try {
                return yield _request(this.fetch, 'POST', `${this.url}/recover`, {
                    body: {
                        email,
                        code_challenge: codeChallenge,
                        code_challenge_method: codeChallengeMethod,
                        gotrue_meta_security: { captcha_token: options.captchaToken },
                    },
                    headers: this.headers,
                    redirectTo: options.redirectTo,
                });
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: null, error };
                }
                throw error;
            }
        });
    }
    /**
     * Generates a new JWT.
     * @param refreshToken A valid refresh token that was returned on login.
     */
    _refreshAccessToken(refreshToken) {
        return __awaiter(this, void 0, void 0, function* () {
            const debugName = `#_refreshAccessToken(${refreshToken.substring(0, 5)}...)`;
            this._debug(debugName, 'begin');
            try {
                const startedAt = Date.now();
                // will attempt to refresh the token with exponential backoff
                return yield retryable((attempt) => __awaiter(this, void 0, void 0, function* () {
                    yield sleep(attempt * 200); // 0, 200, 400, 800, ...
                    this._debug(debugName, 'refreshing attempt', attempt);
                    return yield _request(this.fetch, 'POST', `${this.url}/token?grant_type=refresh_token`, {
                        body: { refresh_token: refreshToken },
                        headers: this.headers,
                        xform: _sessionResponse,
                    });
                }), (attempt, _, result) => result &&
                    result.error &&
                    isAuthRetryableFetchError(result.error) &&
                    // retryable only if the request can be sent before the backoff overflows the tick duration
                    Date.now() + (attempt + 1) * 200 - startedAt < AUTO_REFRESH_TICK_DURATION);
            }
            catch (error) {
                this._debug(debugName, 'error', error);
                if (isAuthError(error)) {
                    return { data: { session: null, user: null }, error };
                }
                throw error;
            }
            finally {
                this._debug(debugName, 'end');
            }
        });
    }
    _isValidSession(maybeSession) {
        const isValidSession = typeof maybeSession === 'object' &&
            maybeSession !== null &&
            'access_token' in maybeSession &&
            'refresh_token' in maybeSession &&
            'expires_at' in maybeSession;
        return isValidSession;
    }
    _handleProviderSignIn(provider, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const url = yield this._getUrlForProvider(provider, {
                redirectTo: options.redirectTo,
                scopes: options.scopes,
                queryParams: options.queryParams,
            });
            this._debug('#_handleProviderSignIn()', 'provider', provider, 'options', options, 'url', url);
            // try to open on the browser
            if (isBrowser() && !options.skipBrowserRedirect) {
                window.location.assign(url);
            }
            return { data: { provider, url }, error: null };
        });
    }
    /**
     * Recovers the session from LocalStorage and refreshes
     * Note: this method is async to accommodate for AsyncStorage e.g. in React native.
     */
    _recoverAndRefresh() {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const debugName = '#_recoverAndRefresh()';
            this._debug(debugName, 'begin');
            try {
                const currentSession = yield getItemAsync(this.storage, this.storageKey);
                this._debug(debugName, 'session from storage', currentSession);
                if (!this._isValidSession(currentSession)) {
                    this._debug(debugName, 'session is not valid');
                    if (currentSession !== null) {
                        yield this._removeSession();
                    }
                    return;
                }
                const timeNow = Math.round(Date.now() / 1000);
                const expiresWithMargin = ((_a = currentSession.expires_at) !== null && _a !== void 0 ? _a : Infinity) < timeNow + EXPIRY_MARGIN;
                this._debug(debugName, `session has${expiresWithMargin ? '' : ' not'} expired with margin of ${EXPIRY_MARGIN}s`);
                if (expiresWithMargin) {
                    if (this.autoRefreshToken && currentSession.refresh_token) {
                        const { error } = yield this._callRefreshToken(currentSession.refresh_token);
                        if (error) {
                            console.error(error);
                            if (!isAuthRetryableFetchError(error)) {
                                this._debug(debugName, 'refresh failed with a non-retryable error, removing the session', error);
                                yield this._removeSession();
                            }
                        }
                    }
                }
                else {
                    // no need to persist currentSession again, as we just loaded it from
                    // local storage; persisting it again may overwrite a value saved by
                    // another client with access to the same local storage
                    yield this._notifyAllSubscribers('SIGNED_IN', currentSession);
                }
            }
            catch (err) {
                this._debug(debugName, 'error', err);
                console.error(err);
                return;
            }
            finally {
                this._debug(debugName, 'end');
            }
        });
    }
    _callRefreshToken(refreshToken) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            if (!refreshToken) {
                throw new AuthSessionMissingError();
            }
            // refreshing is already in progress
            if (this.refreshingDeferred) {
                return this.refreshingDeferred.promise;
            }
            const debugName = `#_callRefreshToken(${refreshToken.substring(0, 5)}...)`;
            this._debug(debugName, 'begin');
            try {
                this.refreshingDeferred = new Deferred();
                const { data, error } = yield this._refreshAccessToken(refreshToken);
                if (error)
                    throw error;
                if (!data.session)
                    throw new AuthSessionMissingError();
                yield this._saveSession(data.session);
                yield this._notifyAllSubscribers('TOKEN_REFRESHED', data.session);
                const result = { session: data.session, error: null };
                this.refreshingDeferred.resolve(result);
                return result;
            }
            catch (error) {
                this._debug(debugName, 'error', error);
                if (isAuthError(error)) {
                    const result = { session: null, error };
                    (_a = this.refreshingDeferred) === null || _a === void 0 ? void 0 : _a.resolve(result);
                    return result;
                }
                (_b = this.refreshingDeferred) === null || _b === void 0 ? void 0 : _b.reject(error);
                throw error;
            }
            finally {
                this.refreshingDeferred = null;
                this._debug(debugName, 'end');
            }
        });
    }
    _notifyAllSubscribers(event, session, broadcast = true) {
        return __awaiter(this, void 0, void 0, function* () {
            const debugName = `#_notifyAllSubscribers(${event})`;
            this._debug(debugName, 'begin', session, `broadcast = ${broadcast}`);
            try {
                if (this.broadcastChannel && broadcast) {
                    this.broadcastChannel.postMessage({ event, session });
                }
                const errors = [];
                const promises = Array.from(this.stateChangeEmitters.values()).map((x) => __awaiter(this, void 0, void 0, function* () {
                    try {
                        yield x.callback(event, session);
                    }
                    catch (e) {
                        errors.push(e);
                    }
                }));
                yield Promise.all(promises);
                if (errors.length > 0) {
                    for (let i = 0; i < errors.length; i += 1) {
                        console.error(errors[i]);
                    }
                    throw errors[0];
                }
            }
            finally {
                this._debug(debugName, 'end');
            }
        });
    }
    /**
     * set currentSession and currentUser
     * process to _startAutoRefreshToken if possible
     */
    _saveSession(session) {
        return __awaiter(this, void 0, void 0, function* () {
            this._debug('#_saveSession()', session);
            if (!this.persistSession) {
                this.inMemorySession = session;
            }
            if (this.persistSession && session.expires_at) {
                yield this._persistSession(session);
            }
        });
    }
    _persistSession(currentSession) {
        this._debug('#_persistSession()', currentSession);
        return setItemAsync(this.storage, this.storageKey, currentSession);
    }
    _removeSession() {
        return __awaiter(this, void 0, void 0, function* () {
            this._debug('#_removeSession()');
            if (this.persistSession) {
                yield removeItemAsync(this.storage, this.storageKey);
            }
            else {
                this.inMemorySession = null;
            }
        });
    }
    /**
     * Removes any registered visibilitychange callback.
     *
     * {@see #startAutoRefresh}
     * {@see #stopAutoRefresh}
     */
    _removeVisibilityChangedCallback() {
        this._debug('#_removeVisibilityChangedCallback()');
        const callback = this.visibilityChangedCallback;
        this.visibilityChangedCallback = null;
        try {
            if (callback && isBrowser() && (window === null || window === void 0 ? void 0 : window.removeEventListener)) {
                window.removeEventListener('visibilitychange', callback);
            }
        }
        catch (e) {
            console.error('removing visibilitychange callback failed', e);
        }
    }
    /**
     * This is the private implementation of {@link #startAutoRefresh}. Use this
     * within the library.
     */
    _startAutoRefresh() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._stopAutoRefresh();
            this._debug('#_startAutoRefresh()');
            const ticker = setInterval(() => this._autoRefreshTokenTick(), AUTO_REFRESH_TICK_DURATION);
            this.autoRefreshTicker = ticker;
            if (ticker && typeof ticker === 'object' && typeof ticker.unref === 'function') {
                // ticker is a NodeJS Timeout object that has an `unref` method
                // https://nodejs.org/api/timers.html#timeoutunref
                // When auto refresh is used in NodeJS (like for testing) the
                // `setInterval` is preventing the process from being marked as
                // finished and tests run endlessly. This can be prevented by calling
                // `unref()` on the returned object.
                ticker.unref();
                // @ts-ignore
            }
            else if (typeof Deno !== 'undefined' && typeof Deno.unrefTimer === 'function') {
                // similar like for NodeJS, but with the Deno API
                // https://deno.land/api@latest?unstable&s=Deno.unrefTimer
                // @ts-ignore
                Deno.unrefTimer(ticker);
            }
            // run the tick immediately
            yield this._autoRefreshTokenTick();
        });
    }
    /**
     * This is the private implementation of {@link #stopAutoRefresh}. Use this
     * within the library.
     */
    _stopAutoRefresh() {
        return __awaiter(this, void 0, void 0, function* () {
            this._debug('#_stopAutoRefresh()');
            const ticker = this.autoRefreshTicker;
            this.autoRefreshTicker = null;
            if (ticker) {
                clearInterval(ticker);
            }
        });
    }
    /**
     * Starts an auto-refresh process in the background. The session is checked
     * every few seconds. Close to the time of expiration a process is started to
     * refresh the session. If refreshing fails it will be retried for as long as
     * necessary.
     *
     * If you set the {@link GoTrueClientOptions#autoRefreshToken} you don't need
     * to call this function, it will be called for you.
     *
     * On browsers the refresh process works only when the tab/window is in the
     * foreground to conserve resources as well as prevent race conditions and
     * flooding auth with requests. If you call this method any managed
     * visibility change callback will be removed and you must manage visibility
     * changes on your own.
     *
     * On non-browser platforms the refresh process works *continuously* in the
     * background, which may not be desirable. You should hook into your
     * platform's foreground indication mechanism and call these methods
     * appropriately to conserve resources.
     *
     * {@see #stopAutoRefresh}
     */
    startAutoRefresh() {
        return __awaiter(this, void 0, void 0, function* () {
            this._removeVisibilityChangedCallback();
            yield this._startAutoRefresh();
        });
    }
    /**
     * Stops an active auto refresh process running in the background (if any).
     *
     * If you call this method any managed visibility change callback will be
     * removed and you must manage visibility changes on your own.
     *
     * See {@link #startAutoRefresh} for more details.
     */
    stopAutoRefresh() {
        return __awaiter(this, void 0, void 0, function* () {
            this._removeVisibilityChangedCallback();
            yield this._stopAutoRefresh();
        });
    }
    /**
     * Runs the auto refresh token tick.
     */
    _autoRefreshTokenTick() {
        return __awaiter(this, void 0, void 0, function* () {
            this._debug('#_autoRefreshTokenTick()', 'begin');
            try {
                const now = Date.now();
                try {
                    const { data: { session }, } = yield this.getSession();
                    if (!session || !session.refresh_token || !session.expires_at) {
                        this._debug('#_autoRefreshTokenTick()', 'no session');
                        return;
                    }
                    // session will expire in this many ticks (or has already expired if <= 0)
                    const expiresInTicks = Math.floor((session.expires_at * 1000 - now) / AUTO_REFRESH_TICK_DURATION);
                    this._debug('#_autoRefreshTokenTick()', `access token expires in ${expiresInTicks} ticks, a tick lasts ${AUTO_REFRESH_TICK_DURATION}ms, refresh threshold is ${AUTO_REFRESH_TICK_THRESHOLD} ticks`);
                    if (expiresInTicks <= AUTO_REFRESH_TICK_THRESHOLD) {
                        yield this._callRefreshToken(session.refresh_token);
                    }
                }
                catch (e) {
                    console.error('Auto refresh tick failed with error. This is likely a transient error.', e);
                }
            }
            finally {
                this._debug('#_autoRefreshTokenTick()', 'end');
            }
        });
    }
    /**
     * Registers callbacks on the browser / platform, which in-turn run
     * algorithms when the browser window/tab are in foreground. On non-browser
     * platforms it assumes always foreground.
     */
    _handleVisibilityChange() {
        return __awaiter(this, void 0, void 0, function* () {
            this._debug('#_handleVisibilityChange()');
            if (!isBrowser() || !(window === null || window === void 0 ? void 0 : window.addEventListener)) {
                if (this.autoRefreshToken) {
                    // in non-browser environments the refresh token ticker runs always
                    this.startAutoRefresh();
                }
                return false;
            }
            try {
                this.visibilityChangedCallback = () => __awaiter(this, void 0, void 0, function* () { return yield this._onVisibilityChanged(false); });
                window === null || window === void 0 ? void 0 : window.addEventListener('visibilitychange', this.visibilityChangedCallback);
                // now immediately call the visbility changed callback to setup with the
                // current visbility state
                yield this._onVisibilityChanged(true); // initial call
            }
            catch (error) {
                console.error('_handleVisibilityChange', error);
            }
        });
    }
    /**
     * Callback registered with `window.addEventListener('visibilitychange')`.
     */
    _onVisibilityChanged(isInitial) {
        return __awaiter(this, void 0, void 0, function* () {
            this._debug(`#_onVisibilityChanged(${isInitial})`, 'visibilityState', document.visibilityState);
            if (document.visibilityState === 'visible') {
                if (!isInitial) {
                    // initial visibility change setup is handled in another flow under #initialize()
                    yield this.initializePromise;
                    yield this._recoverAndRefresh();
                    this._debug('#_onVisibilityChanged()', 'finished waiting for initialize, _recoverAndRefresh');
                }
                if (this.autoRefreshToken) {
                    // in browser environments the refresh token ticker runs only on focused tabs
                    // which prevents race conditions
                    this._startAutoRefresh();
                }
            }
            else if (document.visibilityState === 'hidden') {
                if (this.autoRefreshToken) {
                    this._stopAutoRefresh();
                }
            }
        });
    }
    /**
     * Generates the relevant login URL for a third-party provider.
     * @param options.redirectTo A URL or mobile address to send the user to after they are confirmed.
     * @param options.scopes A space-separated list of scopes granted to the OAuth application.
     * @param options.queryParams An object of key-value pairs containing query parameters granted to the OAuth application.
     */
    _getUrlForProvider(provider, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const urlParams = [`provider=${encodeURIComponent(provider)}`];
            if (options === null || options === void 0 ? void 0 : options.redirectTo) {
                urlParams.push(`redirect_to=${encodeURIComponent(options.redirectTo)}`);
            }
            if (options === null || options === void 0 ? void 0 : options.scopes) {
                urlParams.push(`scopes=${encodeURIComponent(options.scopes)}`);
            }
            if (this.flowType === 'pkce') {
                const codeVerifier = generatePKCEVerifier();
                yield setItemAsync(this.storage, `${this.storageKey}-code-verifier`, codeVerifier);
                const codeChallenge = yield generatePKCEChallenge(codeVerifier);
                const codeChallengeMethod = codeVerifier === codeChallenge ? 'plain' : 's256';
                this._debug('PKCE', 'code verifier', `${codeVerifier.substring(0, 5)}...`, 'code challenge', codeChallenge, 'method', codeChallengeMethod);
                const flowParams = new URLSearchParams({
                    code_challenge: `${encodeURIComponent(codeChallenge)}`,
                    code_challenge_method: `${encodeURIComponent(codeChallengeMethod)}`,
                });
                urlParams.push(flowParams.toString());
            }
            if (options === null || options === void 0 ? void 0 : options.queryParams) {
                const query = new URLSearchParams(options.queryParams);
                urlParams.push(query.toString());
            }
            return `${this.url}/authorize?${urlParams.join('&')}`;
        });
    }
    _unenroll(params) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { data: sessionData, error: sessionError } = yield this.getSession();
                if (sessionError) {
                    return { data: null, error: sessionError };
                }
                return yield _request(this.fetch, 'DELETE', `${this.url}/factors/${params.factorId}`, {
                    headers: this.headers,
                    jwt: (_a = sessionData === null || sessionData === void 0 ? void 0 : sessionData.session) === null || _a === void 0 ? void 0 : _a.access_token,
                });
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: null, error };
                }
                throw error;
            }
        });
    }
    /**
     * {@see GoTrueMFAApi#enroll}
     */
    _enroll(params) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { data: sessionData, error: sessionError } = yield this.getSession();
                if (sessionError) {
                    return { data: null, error: sessionError };
                }
                const { data, error } = yield _request(this.fetch, 'POST', `${this.url}/factors`, {
                    body: {
                        friendly_name: params.friendlyName,
                        factor_type: params.factorType,
                        issuer: params.issuer,
                    },
                    headers: this.headers,
                    jwt: (_a = sessionData === null || sessionData === void 0 ? void 0 : sessionData.session) === null || _a === void 0 ? void 0 : _a.access_token,
                });
                if (error) {
                    return { data: null, error };
                }
                if ((_b = data === null || data === void 0 ? void 0 : data.totp) === null || _b === void 0 ? void 0 : _b.qr_code) {
                    data.totp.qr_code = `data:image/svg+xml;utf-8,${data.totp.qr_code}`;
                }
                return { data, error: null };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: null, error };
                }
                throw error;
            }
        });
    }
    /**
     * {@see GoTrueMFAApi#verify}
     */
    _verify(params) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { data: sessionData, error: sessionError } = yield this.getSession();
                if (sessionError) {
                    return { data: null, error: sessionError };
                }
                const { data, error } = yield _request(this.fetch, 'POST', `${this.url}/factors/${params.factorId}/verify`, {
                    body: { code: params.code, challenge_id: params.challengeId },
                    headers: this.headers,
                    jwt: (_a = sessionData === null || sessionData === void 0 ? void 0 : sessionData.session) === null || _a === void 0 ? void 0 : _a.access_token,
                });
                if (error) {
                    return { data: null, error };
                }
                yield this._saveSession(Object.assign({ expires_at: Math.round(Date.now() / 1000) + data.expires_in }, data));
                yield this._notifyAllSubscribers('MFA_CHALLENGE_VERIFIED', data);
                return { data, error };
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: null, error };
                }
                throw error;
            }
        });
    }
    /**
     * {@see GoTrueMFAApi#challenge}
     */
    _challenge(params) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const { data: sessionData, error: sessionError } = yield this.getSession();
                if (sessionError) {
                    return { data: null, error: sessionError };
                }
                return yield _request(this.fetch, 'POST', `${this.url}/factors/${params.factorId}/challenge`, {
                    headers: this.headers,
                    jwt: (_a = sessionData === null || sessionData === void 0 ? void 0 : sessionData.session) === null || _a === void 0 ? void 0 : _a.access_token,
                });
            }
            catch (error) {
                if (isAuthError(error)) {
                    return { data: null, error };
                }
                throw error;
            }
        });
    }
    /**
     * {@see GoTrueMFAApi#challengeAndVerify}
     */
    _challengeAndVerify(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const { data: challengeData, error: challengeError } = yield this._challenge({
                factorId: params.factorId,
            });
            if (challengeError) {
                return { data: null, error: challengeError };
            }
            return yield this._verify({
                factorId: params.factorId,
                challengeId: challengeData.id,
                code: params.code,
            });
        });
    }
    /**
     * {@see GoTrueMFAApi#listFactors}
     */
    _listFactors() {
        return __awaiter(this, void 0, void 0, function* () {
            const { data: { user }, error: userError, } = yield this.getUser();
            if (userError) {
                return { data: null, error: userError };
            }
            const factors = (user === null || user === void 0 ? void 0 : user.factors) || [];
            const totp = factors.filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified');
            return {
                data: {
                    all: factors,
                    totp,
                },
                error: null,
            };
        });
    }
    /**
     * {@see GoTrueMFAApi#getAuthenticatorAssuranceLevel}
     */
    _getAuthenticatorAssuranceLevel() {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            const { data: { session }, error: sessionError, } = yield this.getSession();
            if (sessionError) {
                return { data: null, error: sessionError };
            }
            if (!session) {
                return {
                    data: { currentLevel: null, nextLevel: null, currentAuthenticationMethods: [] },
                    error: null,
                };
            }
            const payload = this._decodeJWT(session.access_token);
            let currentLevel = null;
            if (payload.aal) {
                currentLevel = payload.aal;
            }
            let nextLevel = currentLevel;
            const verifiedFactors = (_b = (_a = session.user.factors) === null || _a === void 0 ? void 0 : _a.filter((factor) => factor.status === 'verified')) !== null && _b !== void 0 ? _b : [];
            if (verifiedFactors.length > 0) {
                nextLevel = 'aal2';
            }
            const currentAuthenticationMethods = payload.amr || [];
            return { data: { currentLevel, nextLevel, currentAuthenticationMethods }, error: null };
        });
    }
}
GoTrueClient.nextInstanceID = 0;
//# sourceMappingURL=GoTrueClient.js.map