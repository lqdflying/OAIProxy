import * as assert from "assert";
import { logger } from "../logger";

suite("logger", () => {
	test("masks standard and custom credential-bearing headers", () => {
		assert.deepStrictEqual(
			logger.sanitizeHeaders({
				Authorization: "Bearer secret-token",
				"api-key": "foundry-key",
				"X-Auth-Token": "custom-auth-token",
				"X-Custom-Secret": "custom-secret",
				"X-Request-Signature": "signature-value",
				Accept: "application/json",
			}),
			{
				Authorization: "Bearer secr***",
				"api-key": "foun***",
				"X-Auth-Token": "cust***",
				"X-Custom-Secret": "cust***",
				"X-Request-Signature": "sign***",
				Accept: "application/json",
			}
		);
	});

	test("masks short credentials without revealing their length", () => {
		assert.deepStrictEqual(logger.sanitizeHeaders({ "x-api-key": "abc" }), { "x-api-key": "***" });
	});
});
