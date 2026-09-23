import java.math.*;
public class Witness {
  static BigDecimal invoice(String price,int quantity,String variant) {
    if(quantity<0 && !variant.equals("validation")) throw new IllegalArgumentException("quantity");
    BigDecimal total=new BigDecimal(price).multiply(BigDecimal.valueOf(quantity));
    int threshold=variant.equals("threshold")?101:100;
    if(quantity>=threshold)total=total.multiply(new BigDecimal("0.90"));
    return total.setScale(2,variant.equals("rounding")?RoundingMode.DOWN:RoundingMode.HALF_UP);
  }
  static int failures=0;
  static void check(String id,String actual,String expected){boolean ok=actual.equals(expected);System.out.println("ASSERT|"+id+"|"+(ok?"PASS":"FAIL")+"|"+actual+"|"+expected);if(!ok)failures++;}
  public static void main(String[] args){
    String variant=args[0],suite=args[1];
    if(suite.equals("crash"))throw new RuntimeException("unknown execution failure");
    if(suite.equals("missing")){System.out.println("No assertions executed");return;}
    if(suite.equals("always-pass")||suite.equals("always-fail")){
      String[] ids={"ordinary","rounding","below-threshold","threshold","validation"};
      String[] values={"4.00","1.01","99.00","90.00","rejected"};
      for(int i=0;i<ids.length;i++)check(ids[i],suite.equals("always-pass")?values[i]:"unconditional-failure",values[i]);
      System.out.println("SUMMARY|"+failures);if(failures>0)System.exit(1);return;
    }
    check("ordinary",invoice("2.00",2,variant).toPlainString(),"4.00");
    if(suite.equals("strong")){
      check("rounding",invoice("1.005",1,variant).toPlainString(),"1.01");
      check("below-threshold",invoice("1.00",99,variant).toPlainString(),"99.00");
      check("threshold",invoice("1.00",100,variant).toPlainString(),"90.00");
      String result="allowed";try{invoice("1.00",-1,variant);}catch(IllegalArgumentException expected){result="rejected";}
      check("validation",result,"rejected");
    }
    System.out.println("SUMMARY|"+failures);if(failures>0)System.exit(1);
  }
}
