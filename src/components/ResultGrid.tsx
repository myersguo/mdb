import { CheckCircle2, Table2 } from "lucide-react";
import type { ResultSet } from "../lib/db";
import { formatNumber, t, useLocale } from "../i18n";

export default function ResultGrid({
  result,
  offset = 0,
}: {
  result: ResultSet;
  offset?: number;
}) {
  useLocale();
  if (result.columns.length === 0)
    return (
      <div className="result-empty">
        <CheckCircle2 size={27} />
        <h3>{t("result.complete")}</h3>
        <p>
          {t("result.affected", {
            count: formatNumber(BigInt(result.affectedRows)),
          })}
        </p>
      </div>
    );
  return (
    <div
      className="grid-scroll"
      tabIndex={0}
      aria-label={t("result.gridLabel")}
    >
      <table className="data-grid">
        <thead>
          <tr>
            <th className="row-number" aria-label={t("result.rowNumber")}>
              #
            </th>
            {result.columns.map((column, index) => (
              <th key={index}>
                <span>{column.name}</span>
                <small>{column.dataType}</small>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className="row-number">
                {formatNumber(offset + rowIndex + 1)}
              </td>
              {row.map((value, colIndex) => (
                <td
                  key={colIndex}
                  className={value === null ? "null-cell" : ""}
                  title={value ?? "NULL"}
                >
                  {value === null ? (
                    <span>NULL</span>
                  ) : value === "" ? (
                    <span className="empty-string">
                      {t("result.emptyString")}
                    </span>
                  ) : (
                    value
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length === 0 && (
        <div className="result-empty">
          <Table2 size={26} />
          <h3>
            {t(result.truncated ? "result.tooLarge" : "result.noRecords")}
          </h3>
          <p>
            {t(result.truncated ? "result.narrowHint" : "result.emptyHint")}
          </p>
        </div>
      )}
    </div>
  );
}
