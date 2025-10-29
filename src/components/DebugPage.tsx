import React, { useState } from "react";
import { RequestForm } from "./RequestForm";
import { ResponseDisplay } from "./ResponseDisplay";
import { HandleRequestResponse } from "../types";

export interface RequestConfig {
  url: string;
  method: string;
  headers: string;
  body: string;
}

export interface ResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  url: string;
}

export const DebugPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [response, setResponse] = useState<ResponseData | null>(null);

  const handleSubmit = async (config: RequestConfig) => {
    setLoading(true);
    setError("");
    setResponse(null);

    try {
      // Parse headers
      let headers: HeadersInit | undefined;
      if (config.headers.trim()) {
        try {
          headers = JSON.parse(config.headers);
        } catch (e) {
          throw new Error("Invalid JSON in headers field");
        }
      }

      // Build RequestInit
      const init: RequestInit = {
        method: config.method,
        headers,
      };

      // Add body if not GET or HEAD
      if (config.method !== "GET" && config.method !== "HEAD" && config.body.trim()) {
        init.body = config.body;
      }

      // Send message to background script
      const result: HandleRequestResponse = await browser.runtime.sendMessage({
        type: "network-request",
        input: config.url,
        init,
      });

      // Convert base64 to string
      let bodyText = "";
      if (result.base64) {
        if (typeof result.base64 === "string") {
          // base64 is a data URL like "data:application/json;base64,..."
          const base64Content = result.base64.split(",")[1];
          if (base64Content) {
            bodyText = atob(base64Content);
          }
        } else if (result.base64 instanceof ArrayBuffer) {
          bodyText = new TextDecoder().decode(result.base64);
        }
      }

      setResponse({
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
        body: bodyText,
        url: result.url,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            InfoGata Extension Debug Page
          </h1>
          <p className="text-gray-600">
            Test network requests using the InfoGata extension's networkRequest function
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
            <div className="flex items-center">
              <svg
                className="w-5 h-5 mr-2"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="font-medium">Error: </span>
              <span className="ml-1">{error}</span>
            </div>
          </div>
        )}

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Request Form */}
          <div>
            <RequestForm onSubmit={handleSubmit} loading={loading} />
          </div>

          {/* Response Display */}
          <div>
            <ResponseDisplay response={response} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  );
};
