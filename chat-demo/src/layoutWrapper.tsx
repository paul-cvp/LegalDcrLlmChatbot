import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import Layout from "./pages/layout/Layout";

const LayoutWrapper = () => (
    <FluentProvider theme={webLightTheme} style={{ height: "100%", backgroundColor: "transparent" }}>
        <Layout />
    </FluentProvider>
);

export default LayoutWrapper;
