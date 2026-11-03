import { type Locale, translate } from "@promenadis/i18n";
import {
  CalendarDays,
  Compass,
  LogIn,
  LogOut,
  type LucideIcon,
  Menu,
  Settings,
  X,
} from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { subscribeSessionChanges } from "../lib/account-session";
import { getBrowserAuthClient } from "../lib/supabase";
import { cn } from "../lib/utils";
import { LanguageSwitcher } from "./language-switcher";
import { skipLink } from "./page";
import { ThemeSwitcher } from "./theme-switcher";

/**
 * The signed-in account as the browser session reports it: `undefined`
 * while loading, `null` when signed out.
 */
export interface SiteSession {
  readonly accountId: string | null | undefined;
  readonly failed: boolean;
}

const SiteSessionContext = createContext<SiteSession>({ accountId: undefined, failed: false });
export const useSiteSession = () => useContext(SiteSessionContext);

function useSessionAccount(): SiteSession {
  const [session, setSession] = useState<SiteSession>({ accountId: undefined, failed: false });
  useEffect(() => {
    let active = true;
    let version = 0;
    const refresh = async () => {
      const current = ++version;
      const auth = getBrowserAuthClient();
      if (!auth) {
        setSession({ accountId: null, failed: false });
        return;
      }
      const { data, error } = await auth.auth.getSession();
      if (!active || current !== version) return;
      setSession({
        accountId: error ? null : (data.session?.user.id ?? null),
        failed: Boolean(error),
      });
    };
    const unsubscribe = subscribeSessionChanges(() => {
      void refresh();
    });
    void refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return session;
}

function NavItem({
  to,
  icon: Icon,
  children,
}: {
  readonly to: string;
  readonly icon: LucideIcon;
  readonly children: ReactNode;
}) {
  const { pathname } = useLocation();
  const current = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <Link aria-current={current ? "page" : undefined} className={navItem} to={to}>
      <Icon aria-hidden="true" />
      {children}
    </Link>
  );
}

const navItem =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl border-0 bg-transparent px-3 text-left text-[0.95rem] font-semibold text-foreground no-underline transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-50 aria-[current=page]:bg-brand-soft aria-[current=page]:text-primary [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground aria-[current=page]:[&_svg]:text-primary";

/**
 * Every page's frame: a left sidebar with the app's navigation on wide
 * screens, a top bar with a menu button on phones. The theme and language
 * pickers stay visible in both.
 */
export function SiteFrame({
  locale,
  onLocaleChange,
  children,
}: {
  readonly locale: Locale;
  readonly onLocaleChange: (locale: Locale) => void;
  readonly children: ReactNode;
}) {
  const session = useSessionAccount();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Close the phone menu after navigating.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on path change only.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const signOut = async () => {
    const supabase = getBrowserAuthClient(session.accountId);
    if (!supabase) return;
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    setSigningOut(false);
    if (!error) await navigate("/sign-in", { replace: true });
  };

  const signedIn = typeof session.accountId === "string";

  return (
    <SiteSessionContext.Provider value={session}>
      <a className={skipLink} href="#main">
        {translate(locale, "home.skip")}
      </a>
      <div className="min-h-screen lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="sticky top-0 z-40 grid grid-cols-[1fr_auto_auto] items-center gap-x-2 border-b bg-background/90 px-4 py-2 backdrop-blur [grid-template-areas:'brand_appearance_menu'_'nav_nav_nav'] lg:flex lg:h-screen lg:flex-col lg:items-stretch lg:gap-6 lg:border-r lg:border-b-0 lg:bg-card/60 lg:px-4 lg:py-6">
          <a
            aria-label={translate(locale, "app.name")}
            className="inline-flex min-h-11 items-center gap-2.5 font-display text-xl font-extrabold tracking-tight text-foreground no-underline [grid-area:brand] lg:px-2"
            href="/"
          >
            <span
              aria-hidden="true"
              className="grid size-9 -rotate-45 place-items-center rounded-[50%_50%_50%_0.35rem] bg-primary text-base text-primary-foreground shadow-[inset_0_-0.2rem_0_rgb(0_0_0/12%)]"
            >
              <span className="rotate-45">P</span>
            </span>
            <span className="max-[27rem]:sr-only">{translate(locale, "app.name")}</span>
          </a>
          <button
            aria-controls="site-navigation"
            aria-expanded={open}
            className="grid size-11 cursor-pointer place-items-center rounded-full text-foreground [grid-area:menu] hover:bg-accent lg:hidden"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            <span className="sr-only">{translate(locale, "nav.menu")}</span>
          </button>
          <nav
            aria-label={translate(locale, "nav.main")}
            className={cn(
              "flex-col gap-1 pt-2 pb-3 [grid-area:nav] lg:flex lg:flex-1 lg:p-0",
              open ? "flex" : "hidden",
            )}
            id="site-navigation"
          >
            <NavItem icon={Compass} to="/discover">
              {translate(locale, "nav.discover")}
            </NavItem>
            {signedIn ? (
              <>
                <NavItem icon={CalendarDays} to="/dashboard">
                  {translate(locale, "nav.dashboard")}
                </NavItem>
                <NavItem icon={Settings} to="/settings">
                  {translate(locale, "nav.settings")}
                </NavItem>
                <button
                  className={cn(navItem, "lg:mt-auto")}
                  disabled={signingOut}
                  onClick={() => void signOut()}
                  type="button"
                >
                  <LogOut aria-hidden="true" />
                  {translate(locale, "dashboard.signOut")}
                </button>
              </>
            ) : session.accountId === null ? (
              <NavItem icon={LogIn} to="/sign-in">
                {translate(locale, "nav.signIn")}
              </NavItem>
            ) : null}
          </nav>
          <div className="flex items-center gap-1.5 [grid-area:appearance] lg:px-2">
            <ThemeSwitcher locale={locale} />
            <LanguageSwitcher locale={locale} onChange={onLocaleChange} />
          </div>
        </aside>
        <div className="mx-auto w-[min(100%-2rem,72rem)] min-w-0 lg:px-6">{children}</div>
      </div>
    </SiteSessionContext.Provider>
  );
}
