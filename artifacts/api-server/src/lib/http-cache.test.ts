import assert from "node:assert/strict";
import test from "node:test";

import { isHttpResourceNotModified } from "./http-cache";

test("If-None-Match uses weak ETag matching and wildcard support", () => {
  assert.equal(
    isHttpResourceNotModified({
      etag: 'W/"gex-a"',
      ifNoneMatch: 'W/"other", W/"gex-a"',
      lastModified: "Wed, 17 Jun 2026 16:35:48 GMT",
    }),
    true,
  );
  assert.equal(
    isHttpResourceNotModified({
      etag: 'W/"gex-a"',
      ifNoneMatch: '"gex-a"',
      lastModified: "Wed, 17 Jun 2026 16:35:48 GMT",
    }),
    true,
  );
  assert.equal(
    isHttpResourceNotModified({
      etag: 'W/"gex-a"',
      ifNoneMatch: "*",
      lastModified: "Wed, 17 Jun 2026 16:35:48 GMT",
    }),
    true,
  );
  assert.equal(
    isHttpResourceNotModified({
      etag: 'W/"gex-a"',
      ifNoneMatch: 'W/"other"',
      ifModifiedSince: "Thu, 18 Jun 2026 16:35:48 GMT",
      lastModified: "Wed, 17 Jun 2026 16:35:48 GMT",
    }),
    false,
  );
});

test("If-Modified-Since is used only when If-None-Match is absent", () => {
  assert.equal(
    isHttpResourceNotModified({
      etag: 'W/"gex-a"',
      ifModifiedSince: "Thu, 18 Jun 2026 16:35:48 GMT",
      lastModified: "Wed, 17 Jun 2026 16:35:48 GMT",
    }),
    true,
  );
  assert.equal(
    isHttpResourceNotModified({
      etag: 'W/"gex-a"',
      ifModifiedSince: "Tue, 16 Jun 2026 16:35:48 GMT",
      lastModified: "Wed, 17 Jun 2026 16:35:48 GMT",
    }),
    false,
  );
  assert.equal(
    isHttpResourceNotModified({
      etag: 'W/"gex-a"',
      ifModifiedSince: "not a date",
      lastModified: "Wed, 17 Jun 2026 16:35:48 GMT",
    }),
    false,
  );
});
