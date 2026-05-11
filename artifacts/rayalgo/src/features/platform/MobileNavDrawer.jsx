import { SCREENS } from "./screenRegistry.jsx";
import { Drawer } from "../../components/platform/Drawer.jsx";
import { T, dim, fs, sp } from "../../lib/uiTokens.jsx";

const SectionTitle = ({ children }) => (
  <div
    style={{
      padding: sp("10px 12px 6px"),
      color: T.textMuted,
      fontFamily: T.sans,
      fontSize: fs(8),
      fontWeight: 400,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
    }}
  >
    {children}
  </div>
);

export const MobileNavDrawer = ({
  open,
  onClose,
  activeScreen,
  setScreen,
  HeaderAccountStripComponent,
  HeaderStatusClusterComponent,
  accounts,
  primaryAccountId,
  primaryAccount,
  onSelectAccount,
  maskAccountValues,
  session,
  environment,
  bridgeTone,
  theme,
  onToggleTheme,
}) => {
  const handleScreenSelect = (screenId) => {
    setScreen(screenId);
    onClose?.();
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="RayAlgo Navigation"
      width={360}
      testId="mobile-nav-drawer"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: "100%",
          background: T.bg0,
        }}
      >
        <SectionTitle>Screens</SectionTitle>
        <div
          data-testid="mobile-nav-screen-list"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: sp(6),
            padding: sp("0 10px 10px"),
          }}
        >
          {SCREENS.map((screen) => {
            const active = activeScreen === screen.id;
            return (
              <button
                key={screen.id}
                type="button"
                data-testid={`mobile-nav-screen-${screen.id}`}
                aria-current={active ? "page" : undefined}
                onClick={() => handleScreenSelect(screen.id)}
                style={{
                  minHeight: dim(44),
                  display: "flex",
                  alignItems: "center",
                  gap: sp(8),
                  padding: sp("0 10px"),
                  border: `1px solid ${active ? T.accent : T.border}`,
                  borderRadius: dim(4),
                  background: active ? `${T.accent}18` : T.bg1,
                  color: active ? T.text : T.textSec,
                  cursor: "pointer",
                  fontFamily: T.sans,
                  fontSize: fs(11),
                  fontWeight: 400,
                  textAlign: "left",
                }}
              >
                <span aria-hidden="true" style={{ color: active ? T.accent : T.textDim }}>
                  {screen.icon}
                </span>
                <span>{screen.label}</span>
              </button>
            );
          })}
        </div>

        {HeaderAccountStripComponent || HeaderStatusClusterComponent ? (
          <>
            <SectionTitle>Account</SectionTitle>
            <div
              style={{
                display: "grid",
                gap: sp(8),
                padding: sp("0 10px 10px"),
              }}
            >
              {HeaderAccountStripComponent ? (
                <HeaderAccountStripComponent
                  accounts={accounts}
                  primaryAccountId={primaryAccountId}
                  primaryAccount={primaryAccount}
                  onSelectAccount={onSelectAccount}
                  maskValues={maskAccountValues}
                />
              ) : null}
              {HeaderStatusClusterComponent ? (
                <HeaderStatusClusterComponent
                  session={session}
                  environment={environment}
                  bridgeTone={bridgeTone}
                  theme={theme}
                  onToggleTheme={onToggleTheme}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  );
};

export default MobileNavDrawer;
