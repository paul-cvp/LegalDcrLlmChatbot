import { useId } from "react";
import { useTranslation } from "../../../node_modules/react-i18next";
import { Checkbox, Dropdown, Input, Option } from "@fluentui/react-components";
import type { OptionOnSelectData, SelectionEvents } from "@fluentui/react-components";
import type { DcrRole, SearchIndex } from "../../api";
import { HelpCallout } from "../HelpCallout";
import styles from "./Settings.module.css";

export interface SettingsProps {
    dcrRole: DcrRole;
    searchIndex: SearchIndex;
    includeFollowupQuestions: boolean;
    retrieveCount: number;
    minimumSearchScore: number;
    className?: string;
    onChange: (field: string, value: DcrRole | SearchIndex | number | boolean) => void;
}

const DCR_ROLES: DcrRole[] = ["Citizen", "Caseworker"];
const SEARCH_INDEXES: { value: SearchIndex; label: string }[] = [
    { value: "All", label: "all" },
    { value: "Relevant laws", label: "relevantLaws" },
    { value: "Similar cases", label: "similarCases" }
];

export const Settings = ({ dcrRole, searchIndex, includeFollowupQuestions, retrieveCount, minimumSearchScore, className, onChange }: SettingsProps) => {
    const { t } = useTranslation();
    const roleId = useId();
    const roleFieldId = useId();
    const searchIndexId = useId();
    const searchIndexFieldId = useId();
    const followupQuestionsFieldId = useId();
    const searchScoreId = useId();
    const searchScoreFieldId = useId();
    const retrieveCountId = useId();
    const retrieveCountFieldId = useId();

    return (
        <div className={className}>
            <div className={styles.settingsField}>
                <label id={roleId} htmlFor={roleFieldId}>
                    {t("labels.dcrRole")}
                </label>
                <Dropdown
                    id={roleFieldId}
                    selectedOptions={[dcrRole]}
                    value={t(`labels.dcrRoleOptions.${dcrRole}`)}
                    onOptionSelect={(_ev: SelectionEvents, data: OptionOnSelectData) => onChange("dcrRole", data.optionValue as DcrRole)}
                    aria-labelledby={roleId}
                >
                    {DCR_ROLES.map(role => (
                        <Option key={role} value={role}>
                            {t(`labels.dcrRoleOptions.${role}`)}
                        </Option>
                    ))}
                </Dropdown>
            </div>

            <div className={styles.settingsCheckbox}>
                <Checkbox
                    id={followupQuestionsFieldId}
                    checked={includeFollowupQuestions}
                    label={t("labels.useSuggestFollowupQuestions")}
                    onChange={(_ev, data) => onChange("useSuggestFollowupQuestions", !!data.checked)}
                />
            </div>

            <div className={styles.settingsField}>
                <label id={searchIndexId} htmlFor={searchIndexFieldId}>
                    {t("labels.searchIndex")}
                </label>
                <Dropdown
                    id={searchIndexFieldId}
                    selectedOptions={[searchIndex]}
                    value={t(`labels.searchIndexOptions.${SEARCH_INDEXES.find(index => index.value === searchIndex)?.label}`)}
                    onOptionSelect={(_ev: SelectionEvents, data: OptionOnSelectData) => onChange("searchIndex", data.optionValue as SearchIndex)}
                    aria-labelledby={searchIndexId}
                >
                    {SEARCH_INDEXES.map(index => (
                        <Option key={index.value} value={index.value}>
                            {t(`labels.searchIndexOptions.${index.label}`)}
                        </Option>
                    ))}
                </Dropdown>
            </div>

            <div className={styles.settingsField}>
                <HelpCallout
                    labelId={searchScoreId}
                    fieldId={searchScoreFieldId}
                    helpText={t("helpTexts.searchScore")}
                    label={t("labels.minimumSearchScore")}
                />
                <Input
                    id={searchScoreFieldId}
                    type="number"
                    min={0}
                    step={0.01}
                    value={minimumSearchScore.toString()}
                    onChange={(_ev, data) => onChange("minimumSearchScore", parseFloat(data.value || "0"))}
                    aria-labelledby={searchScoreId}
                />
            </div>

            <div className={styles.settingsField}>
                <HelpCallout
                    labelId={retrieveCountId}
                    fieldId={retrieveCountFieldId}
                    helpText={t("helpTexts.retrieveNumber")}
                    label={t("labels.retrieveCount")}
                />
                <Input
                    id={retrieveCountFieldId}
                    type="number"
                    min={1}
                    max={50}
                    value={retrieveCount.toString()}
                    onChange={(_ev, data) => onChange("retrieveCount", parseInt(data.value || "1"))}
                    aria-labelledby={retrieveCountId}
                />
            </div>
        </div>
    );
};
