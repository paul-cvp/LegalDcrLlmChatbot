import { animated, useSpring } from "@react-spring/web";
import { useTranslation } from "../../../node_modules/react-i18next";

import styles from "./Answer.module.css";

export const AnswerLoading = () => {
    const { t } = useTranslation();
    const animatedStyles = useSpring({
        from: { opacity: 0 },
        to: { opacity: 1 }
    });

    return (
        <animated.div style={{ ...animatedStyles }}>
            <div className={styles.answerContainer} style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ flexGrow: 1 }}>
                    <p className={styles.answerText}>
                        {t("generatingAnswer")}
                        <span className={styles.loadingdots} />
                    </p>
                </div>
            </div>
        </animated.div>
    );
};
