import { OverlayDrawer, DrawerHeader, DrawerHeaderTitle, DrawerBody, Spinner, Button } from "@fluentui/react-components";
import { Dismiss24Regular } from "@fluentui/react-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { HistoryData, HistoryItem } from "../HistoryItem";
import { Answers, HistoryProviderOptions } from "../HistoryProviders/IProvider";
import { useHistoryManager, HistoryMetaData } from "../HistoryProviders";
import { useTranslation } from "../../../node_modules/react-i18next";
import styles from "./HistoryPanel.module.css";

const HISTORY_COUNT_PER_LOAD = 20;

export const HistoryPanel = ({
    provider,
    isOpen,
    notify,
    onClose,
    onChatSelected
}: {
    provider: HistoryProviderOptions;
    isOpen: boolean;
    notify: boolean;
    onClose: () => void;
    onChatSelected: (answers: Answers) => void;
}) => {
    const historyManager = useHistoryManager(provider);
    const [history, setHistory] = useState<HistoryMetaData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasMoreHistory, setHasMoreHistory] = useState(false);
    const loadingRef = useRef(false);
    const loadGenerationRef = useRef(0);

    useEffect(() => {
        if (!isOpen) return;
        if (notify) {
            loadGenerationRef.current += 1;
            loadingRef.current = false;
            setHistory([]);
            historyManager.resetContinuationToken();
            setHasMoreHistory(true);
        }
    }, [isOpen, notify]);

    const loadMoreHistory = async () => {
        if (loadingRef.current) return;

        loadingRef.current = true;
        const generation = loadGenerationRef.current;
        setIsLoading(true);
        try {
            const items = await historyManager.getNextItems(HISTORY_COUNT_PER_LOAD);
            if (generation !== loadGenerationRef.current) return;

            setHasMoreHistory(items.length === HISTORY_COUNT_PER_LOAD);
            setHistory(previous => {
                const loadedIds = new Set(previous.map(item => item.id));
                return [...previous, ...items.filter(item => !loadedIds.has(item.id))];
            });
        } finally {
            if (generation === loadGenerationRef.current) {
                loadingRef.current = false;
                setIsLoading(false);
            }
        }
    };

    const handleSelect = async (id: string) => {
        const item = await historyManager.getItem(id);
        if (item) {
            onChatSelected(item);
        }
    };

    const handleDelete = async (id: string) => {
        await historyManager.deleteItem(id);
        setHistory(prevHistory => prevHistory.filter(item => item.id !== id));
    };

    const groupedHistory = useMemo(() => groupHistory(history), [history]);

    const { t } = useTranslation();

    const handleClose = () => {
        loadGenerationRef.current += 1;
        loadingRef.current = false;
        setHistory([]);
        setIsLoading(false);
        setHasMoreHistory(true);
        historyManager.resetContinuationToken();
        onClose();
    };

    return (
        <OverlayDrawer
            position="start"
            style={{ width: "300px" }}
            modalType="non-modal"
            open={isOpen}
            onOpenChange={(_ev: any, { open }: { open: boolean }) => {
                if (!open) {
                    handleClose();
                }
            }}
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={<Button appearance="subtle" aria-label={t("labels.closeButton")} icon={<Dismiss24Regular />} onClick={handleClose} />}
                >
                    {t("history.chatHistory")}
                </DrawerHeaderTitle>
            </DrawerHeader>
            <DrawerBody style={{ padding: "0px" }}>
                {Object.entries(groupedHistory).map(([group, items]) => (
                    <div key={group} className={styles.group}>
                        <p className={styles.groupLabel}>{t(group)}</p>
                        {items.map(item => (
                            <HistoryItem key={item.id} item={item} onSelect={handleSelect} onDelete={handleDelete} />
                        ))}
                    </div>
                ))}
                {isLoading && <Spinner style={{ marginTop: "10px" }} />}
                {history.length === 0 && !isLoading && <p>{t("history.noHistory")}</p>}
                {hasMoreHistory && !isLoading && <InfiniteLoadingButton func={loadMoreHistory} />}
            </DrawerBody>
        </OverlayDrawer>
    );
};

function groupHistory(history: HistoryData[]) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastMonth = new Date(today);
    lastMonth.setDate(lastMonth.getDate() - 30);

    return history.reduce(
        (groups, item) => {
            const itemDate = new Date(item.timestamp);
            let group;

            if (itemDate >= today) {
                group = "history.today";
            } else if (itemDate >= yesterday) {
                group = "history.yesterday";
            } else if (itemDate >= lastWeek) {
                group = "history.last7days";
            } else if (itemDate >= lastMonth) {
                group = "history.last30days";
            } else {
                group = itemDate.toLocaleDateString(undefined, { year: "numeric", month: "long" });
            }

            if (!groups[group]) {
                groups[group] = [];
            }
            groups[group].push(item);
            return groups;
        },
        {} as Record<string, HistoryData[]>
    );
}

const InfiniteLoadingButton = ({ func }: { func: () => void }) => {
    const buttonRef = useRef(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        if (buttonRef.current) {
                            func();
                        }
                    }
                });
            },
            {
                root: null,
                threshold: 0
            }
        );

        if (buttonRef.current) {
            observer.observe(buttonRef.current);
        }

        return () => {
            if (buttonRef.current) {
                observer.unobserve(buttonRef.current);
            }
        };
    }, []);

    return <button ref={buttonRef} onClick={func} />;
};
