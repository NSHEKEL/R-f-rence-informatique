const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const helpers = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/src/lib/productForm.ts`, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:helpers});
test('factory purchase follows reference packaging and FCFA rounding; manual edits survive',()=>{
 const {piecePurchasePrice:calc,followPurchasePrice:follow,purchaseFactor:factor}=helpers;
 const form={packaging_unit:'Carton',units_per_packaging:6,packagings:[{active:true,factor:12,sort_order:0}]};
 assert.equal(calc(6000,factor(form)),1000);
 assert.equal(factor({...form,packaging_unit:''}),12);
 assert.equal(factor({...form,packaging_unit:'',packagings:[{active:false,factor:24,sort_order:0},{active:true,factor:6,sort_order:1}]}),6);
 assert.equal(follow(777,calc(12000,6),true),777);
 assert.equal(follow(777,calc(12000,6),false),2000);
 assert.equal(calc(1000,6),167);
 for(const [price,size] of [['',6],[0,6],[6000,0],[6000,null],[Infinity,6],[6000,NaN]]){
  assert.equal(calc(price,size),null);assert.equal(follow(777,calc(price,size),false),777);
 }
});

test('opening and saving an existing per-piece price never divides stored prices',()=>{
 const {piecePurchasePrice:calc,followPurchasePrice:follow,purchaseFactor:factor}=helpers;
 const stored={purchase_price:60,supplier_purchase_price:60,packaging_unit:'Carton',units_per_packaging:24,packagings:[]};
 const calculatorTotal='';
 const opened={...stored,purchase_price:follow(stored.purchase_price,calc(calculatorTotal,factor(stored)),false)};
 const saved={...opened};
 assert.deepEqual(saved,stored);
 const calculated={...opened,purchase_price:follow(opened.purchase_price,calc(6000,6),false)};
 assert.equal(calculated.purchase_price,1000);
 assert.equal(calculated.supplier_purchase_price,60);
});
