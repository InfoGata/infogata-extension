import React, { useState } from "react";
import { RequestConfig } from "./DebugPage";

interface RequestFormProps {
  onSubmit: (config: RequestConfig) => void;
  loading: boolean;
}

const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
];

export const RequestForm: React.FC<RequestFormProps> = ({ onSubmit, loading }) => {
  const [url, setUrl] = useState("https://api.github.com/repos/facebook/react");
  const [method, setMethod] = useState("GET");
  const [headers, setHeaders] = useState('{\n  "Accept": "application/json"\n}');
  const [body, setBody] = useState('{\n  "example": "data"\n}');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ url, method, headers, body });
  };

  const handleClear = () => {
    setUrl("");
    setMethod("GET");
    setHeaders("");
    setBody("");
  };

  const isBodyDisabled = method === "GET" || method === "HEAD";

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Request Configuration</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* URL Input */}
        <div>
          <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
            URL
          </label>
          <input
            id="url"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.example.com/endpoint"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
            required
            disabled={loading}
          />
        </div>

        {/* Method Selector */}
        <div>
          <label htmlFor="method" className="block text-sm font-medium text-gray-700 mb-1">
            HTTP Method
          </label>
          <select
            id="method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition bg-white"
            disabled={loading}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Headers Input */}
        <div>
          <label htmlFor="headers" className="block text-sm font-medium text-gray-700 mb-1">
            Headers (JSON)
          </label>
          <textarea
            id="headers"
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            placeholder='{\n  "Content-Type": "application/json"\n}'
            rows={6}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition font-mono text-sm"
            disabled={loading}
          />
          <p className="text-xs text-gray-500 mt-1">
            Optional. Must be valid JSON format.
          </p>
        </div>

        {/* Body Input */}
        <div>
          <label htmlFor="body" className="block text-sm font-medium text-gray-700 mb-1">
            Request Body
          </label>
          <textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder='{\n  "key": "value"\n}'
            rows={6}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition font-mono text-sm disabled:bg-gray-100 disabled:text-gray-500"
            disabled={loading || isBodyDisabled}
          />
          {isBodyDisabled && (
            <p className="text-xs text-gray-500 mt-1">
              Body is not allowed for {method} requests.
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-lg transition disabled:bg-blue-400 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-5 w-5 text-white"
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
                Sending Request...
              </>
            ) : (
              "Send Request"
            )}
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={loading}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear
          </button>
        </div>
      </form>
    </div>
  );
};
