import React, { useState } from "react";
import { ResponseData } from "./DebugPage";

interface ResponseDisplayProps {
  response: ResponseData | null;
  loading: boolean;
}

export const ResponseDisplay: React.FC<ResponseDisplayProps> = ({
  response,
  loading,
}) => {
  const [activeTab, setActiveTab] = useState<"body" | "headers">("body");

  const formatJSON = (text: string): string => {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  };

  const getStatusColor = (status: number): string => {
    if (status >= 200 && status < 300) return "text-green-600";
    if (status >= 300 && status < 400) return "text-blue-600";
    if (status >= 400 && status < 500) return "text-orange-600";
    return "text-red-600";
  };

  const isJSON = (text: string): boolean => {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Response</h2>

      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <svg
            className="animate-spin h-12 w-12 text-blue-600 mb-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          <p className="text-gray-600">Sending request...</p>
        </div>
      )}

      {!loading && !response && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <svg
            className="w-16 h-16 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="text-center">
            No response yet.
            <br />
            Send a request to see the results here.
          </p>
        </div>
      )}

      {!loading && response && (
        <div className="space-y-4">
          {/* Status Section */}
          <div className="border-b border-gray-200 pb-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-sm font-medium text-gray-700">Status:</span>
              <span className={`text-2xl font-bold ${getStatusColor(response.status)}`}>
                {response.status} {response.statusText}
              </span>
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium">URL:</span>{" "}
              <span className="break-all">{response.url}</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-gray-200">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab("body")}
                className={`pb-2 px-1 text-sm font-medium transition border-b-2 ${
                  activeTab === "body"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                Response Body
              </button>
              <button
                onClick={() => setActiveTab("headers")}
                className={`pb-2 px-1 text-sm font-medium transition border-b-2 ${
                  activeTab === "headers"
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-600 hover:text-gray-900"
                }`}
              >
                Response Headers
              </button>
            </div>
          </div>

          {/* Body Tab */}
          {activeTab === "body" && (
            <div>
              {response.body ? (
                <div className="bg-gray-900 rounded-lg p-4 overflow-auto max-h-96">
                  <pre className="text-green-400 text-sm font-mono whitespace-pre-wrap break-words">
                    {isJSON(response.body) ? formatJSON(response.body) : response.body}
                  </pre>
                </div>
              ) : (
                <div className="text-gray-500 text-center py-8 bg-gray-50 rounded-lg">
                  No response body
                </div>
              )}
            </div>
          )}

          {/* Headers Tab */}
          {activeTab === "headers" && (
            <div>
              {Object.keys(response.headers).length > 0 ? (
                <div className="bg-gray-50 rounded-lg p-4 overflow-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th className="text-left py-2 pr-4 font-semibold text-gray-700">
                          Header
                        </th>
                        <th className="text-left py-2 font-semibold text-gray-700">
                          Value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(response.headers).map(([key, value]) => (
                        <tr key={key} className="border-b border-gray-200">
                          <td className="py-2 pr-4 font-medium text-gray-900 align-top">
                            {key}
                          </td>
                          <td className="py-2 text-gray-700 break-all font-mono">
                            {value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-gray-500 text-center py-8 bg-gray-50 rounded-lg">
                  No response headers
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
