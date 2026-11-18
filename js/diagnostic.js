console.log("=== SEEMYDRIVER ASSET DIAGNOSTIC ===");
document.querySelectorAll('link[rel="stylesheet"], script, link[rel="manifest"]').forEach(el => {
    console.log(el.tagName, el.href || el.src);
});
