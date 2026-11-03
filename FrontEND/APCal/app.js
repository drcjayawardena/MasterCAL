(() => {
  const $ = id => document.getElementById(id);
  const fields = ['product','valuation','exposure','facility','bicRate','insurance','stampMode','stampRate','period','irr','scheduleType','bulkPercent','bulkAmount','cribCharges','cribScore','valuationCharges','serviceCharges','vatRate','otherRmv','rmvType'];
  const n = id => Math.max(0, Number($(id).value) || 0);
  const money = value => (Number.isFinite(value) ? value : 0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2});
  const pmt = (rate, periods, principal, future = 0) => {
    if (periods <= 0) return 0;
    if (rate === 0) return Math.max(0,(principal-future)/periods);
    const factor = Math.pow(1+rate,periods);
    return (principal*factor-future)*rate/(factor-1);
  };
  function calculate() {
    const valuation=n('valuation'), exposure=n('exposure'), facility=n('facility'), bicRate=n('bicRate')/100, insurance=n('insurance'), rate=n('irr')/1200;
    const period=Math.max(1,Math.min(72,Math.floor(n('period')))), stampRate=n('stampRate')/100;
    const bic = $('product').value==='AUTO LOANS' && bicRate===.02 ? facility*.01 : facility*bicRate;
    const stamp = facility*stampRate;
    const capitalStamp=$('stampMode').value==='capitalized' ? stamp : 0;
    const principal=facility+bic+insurance+capitalStamp;
    const type=$('scheduleType').value, bulkAmount=Math.min(n('bulkAmount'),principal), bulkPct=n('bulkPercent')/100;
    const lastBulk=type==='bulk' ? (bulkAmount>0 ? bulkAmount : facility*bulkPct) : 0;
    const regular=Math.ceil(type==='bulk' && period>1 ? pmt(rate,period-1,principal,lastBulk*(1-rate+rate*rate)) : pmt(rate,period,principal)+150);
    const scheduled=(type==='bulk' && period>1 ? regular*(period-1)+lastBulk : regular*period);
    let bal=principal,totalInterest=0,rows=[]; const count=period;
    for(let month=1;month<=count;month++){
      const opening=bal, interest=opening*rate, rental=month===count && type==='bulk' ? 0 : regular;
      let capital=Math.max(0,rental-interest), bulk=month===count?lastBulk:0;
      let close=Math.max(0,opening-capital-bulk);
      if(month===count && type==='normal'){capital=opening;close=0;}
      totalInterest+=interest; rows.push({month,opening,rental,interest,capital,bulk,close,due:rental+bulk}); bal=close;
    }
    const charges={crib:n('cribCharges'),score:n('cribScore'),valuation:n('valuationCharges'),service:n('serviceCharges'),bicCollected:$('product').value==='AUTO LOANS'?bic:0,vat:0,other:n('otherRmv'),rmv:n('rmvType'),stamp:$('stampMode').value==='paid'?stamp:0};
    charges.vat=(charges.service+charges.bicCollected)*(n('vatRate')/100);
    const totalCharges=Object.values(charges).reduce((a,b)=>a+b,0);
    const residualValue=facility*bulkPct, residualRental=Math.ceil(pmt(rate,period,principal,residualValue)+150);
    const residualPaid=residualRental*period+residualValue, residualInterest=Math.max(0,residualPaid-principal);
    $('monthlyRental').textContent=money(regular); $('ratePer100k').textContent=money(regular/(facility/100000||1)); $('totalInterest').textContent=money(Math.max(0,scheduled-principal)); $('totalPaid').textContent=money(scheduled); $('amountFinanced').textContent=money(principal);
    $('residualRental').textContent=money(residualRental); $('residualValue').textContent=money(residualValue); $('residualInterest').textContent=money(residualInterest); $('residualPaid').textContent=money(residualPaid);
    $('chargeTotal').textContent=money(totalCharges); $('bicCollected').textContent=money(charges.bicCollected); $('vatAmount').textContent=money(charges.vat); $('rmvAmount').textContent=money(charges.rmv); $('stampCharge').textContent=money(charges.stamp);
    const note=$('exposureNote'), actual=valuation ? facility/valuation*100 : 0, allowed=valuation*exposure/100;
    note.textContent=valuation ? `Exposure: ${actual.toFixed(2)}% · maximum facility at ${exposure}%: LKR ${money(allowed)}` : '';
    note.classList.toggle('over',valuation>0 && facility>allowed);
    $('scheduleRows').innerHTML=rows.map(r=>`<tr><td>${r.month}</td><td>${money(r.opening)}</td><td>${money(r.rental)}</td><td>${money(r.interest)}</td><td>${money(r.capital)}</td><td>${money(r.bulk)}</td><td>${money(r.close)}</td><td>${money(r.due)}</td></tr>`).join('');
  }
  fields.forEach(id=>$(id).addEventListener('input',calculate)); fields.forEach(id=>$(id).addEventListener('change',calculate));
  $('scheduleButton').addEventListener('click',()=>{const open=$('scheduleSection').hidden;$('scheduleSection').hidden=!open;$('scheduleButton').setAttribute('aria-expanded',String(open));$('scheduleButton').textContent=open?'HIDE RENTAL SCHEDULE':'SHOW RENTAL SCHEDULE';if(open)$('scheduleSection').scrollIntoView({behavior:'smooth',block:'start'});});
  $('printButton').addEventListener('click',()=>window.print());
  calculate();
})();

