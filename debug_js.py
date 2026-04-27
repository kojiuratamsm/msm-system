import objc
from Foundation import NSURL, NSString, NSUTF8StringEncoding
import WebKit

def run_debug():
    url = NSURL.fileURLWithPath_("/Users/kojiurata/Desktop/自社管理サイト/index.html")
    # Actually PyObjC requires a runloop to use WebKit.
    print("Testing syntax for all js files...")

run_debug()
