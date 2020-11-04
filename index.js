const peto = (args) => {
  const {
    url,
    body,
    headers: hdrs,
    contentType,
    allowInsecureRequest = false,
    allowRedirect = true,
    allowCookies = true,
    reds = 0,
    maxRedirs = 5,
  } = args;
  let { method = "GET", proxy, useHttp = false } = args;

  const { URL } = require("url");
  const _url = new URL(url);
  const { protocol, hostname, search } = _url;
  let { pathname: path, port } = _url;
  port *= 1;
  if (search) path += search;
  if (!port && protocol)
    switch (protocol) {
      case "https:":
        port = 443;
        break;
      default:
        port = 80;
        break;
    }
  if (port === 80) useHttp = true;

  let data;
  let cType;
  if (body) {
    if (typeof body === "object") {
      data = JSON.stringify(body);
      cType = "application/json";
    } else if (contentType) cType = contentType;
    else cType = "application/x-www-formurlencoded";
  }

  if (body && method === "GET") method = "POST";

  let headers = { "Accept-Encoding": "gzip" };
  if (cType) headers = { ...headers, "Content-Type": cType };
  if (data) headers = { ...headers, "Content-Length": data.length };
  if (hdrs && typeof hdrs === "object") headers = { ...headers, ...hdrs };

  let options = { hostname, port, method, path, headers };

  return new Promise((resolve, reject) => {
    if (allowInsecureRequest) process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

    const sendReq = (props = {}) => {
      const { socket, agent } = props;
      if (typeof socket !== "undefined") options = { ...options, socket };
      if (typeof agent !== "undefined") options = { ...options, agent };

      const req = require(`http${!useHttp ? "s" : ""}`).request(
        options,
        (res) => {
          const { statusCode, statusMessage, headers } = res;

          const contentEnc = headers["content-encoding"];
          const isGzip = contentEnc === "gzip";

          let resp;
          if (isGzip) {
            resp = require("zlib").createGunzip();
            res.pipe(resp);
          } else resp = res;

          let buff = [];
          resp
            .on("data", (d) => buff.push(d.toString()))
            .on("end", () => {
              let _url;
              if (
                allowRedirect &&
                statusCode >= 300 &&
                statusCode <= 399 &&
                (_url = headers.location) &&
                reds < maxRedirs
              )
                return peto({ ...args, reds: reds + 1, url: _url }).then(
                  resolve
                );

              buff = buff.join("");
              const contentType = headers["content-type"];
              if (contentType && /^application\/json/i.test(contentType))
                try {
                  buff = JSON.parse(buff);
                } catch (e) {}

              if (socket) socket.destroy();
              resolve({
                statusCode,
                statusMessage,
                status: `${statusCode} ${statusMessage}`,
                headers,
                data: buff,
                complete: res.complete,
                maxRedirsReached: reds === maxRedirs,
                url: _url || url,
              });
            })
            .on("error", (err) => reject(err));
        }
      );

      req.on("error", (err) => reject(err));

      if (data) req.write(data);
      else if (body) req.write(body);
      req.end();
    };

    if (!proxy) return sendReq();

    if (!/^[a-zA-Z]{3,5}:\/\//.test(proxy)) proxy = "http://" + proxy;
    const _proxy = new URL(proxy);
    const { hostname, username, password } = _proxy;
    let { port } = _proxy;

    if (!port) port = 3128;

    let headers;
    if (username || password)
      headers = {
        "Proxy-Authorization":
          "Basic " + Buffer.from(username + ":" + password).toString("base64"),
      };

    const path = `${options.hostname}:${options.port}${options.path}`;

    let opts = { host: hostname, port, method: "CONNECT", path };
    if (typeof headers !== "undefined") opts = { ...opts, headers };

    const proxied = require("http")
      .request(opts)
      .on("connect", ({ statusCode }, socket) => {
        if (statusCode < 200 || statusCode > 299) return reject(statusCode);

        return sendReq({ socket, agent: false, proxied });
      })
      .on("error", (err) => reject(err))
      .end();
  });
};

module.exports = peto;
